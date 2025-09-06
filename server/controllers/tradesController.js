const db = require('../db') // knex instance (adjust if your project uses a different DB client)
 
// Update a trade (PUT /api/trades/:id)
async function updateTrade(req, res) {
  const id = Number(req.params.id)
  const { action } = req.body
  const userId = req.user?.id // assuming auth middleware sets req.user

  if (!id || !action) return res.status(400).json({ error: 'Invalid parameters' })

  try {
    await db.transaction(async (trx) => {
      const trade = await trx('trades').where({ id }).first()
      if (!trade) throw { status: 404, message: 'Trade not found' }

      // Handle 'complete' action: set buyer/seller confirmation flags
      if (action === 'complete') {
        const isBuyer = userId && trade.buyer_id === userId
        const isSeller = userId && trade.seller_id === userId

        const updates = {}
        if (isBuyer) updates.buyer_completed = true
        if (isSeller) updates.seller_completed = true

        // Allow compatibility if client sends explicit flags
        if (req.body.buyer_completed !== undefined) updates.buyer_completed = !!req.body.buyer_completed
        if (req.body.seller_completed !== undefined) updates.seller_completed = !!req.body.seller_completed

        if (Object.keys(updates).length > 0) {
          await trx('trades').where({ id }).update(updates)
        }

        // Re-fetch trade to inspect confirmation flags
        const updated = await trx('trades').where({ id }).first()
        const buyerConfirmed = !!updated.buyer_completed
        const sellerConfirmed = !!updated.seller_completed

        // If both confirmed, finalize trade and mark products as sold/traded
        if (buyerConfirmed && sellerConfirmed) {
          await trx('trades').where({ id }).update({ status: 'completed', completed_at: trx.fn ? trx.fn.now() : db.fn.now() })

          // Gather product IDs from multiple possible structures
          let productIds = []

          // 1) trade_items table (common pattern)
          try {
            const items = await trx('trade_items').where({ trade_id: id }).select('product_id')
            if (items && items.length) productIds = items.map(i => i.product_id)
          } catch (e) {
            // ignore if table doesn't exist
          }

          // 2) JSON column on trades (items or item_ids)
          if (productIds.length === 0) {
            try {
              const raw = updated.items || updated.item_ids || null
              if (Array.isArray(raw)) {
                productIds = raw.map(x => (typeof x === 'object' ? (x.product_id ?? x.id ?? null) : x)).filter(Boolean)
              } else if (typeof raw === 'string') {
                const parsed = JSON.parse(raw || '[]')
                if (Array.isArray(parsed)) {
                  productIds = parsed.map(x => (typeof x === 'object' ? (x.product_id ?? x.id ?? null) : x)).filter(Boolean)
                }
              }
            } catch (e) {
              // ignore parse errors
            }
          }

          // 3) explicit columns fallback
          if (productIds.length === 0) {
            if (updated.target_product_id) productIds.push(updated.target_product_id)
            if (updated.offered_product_id) productIds.push(updated.offered_product_id)
          }

          productIds = Array.from(new Set(productIds.map(Number).filter(Boolean)))

          if (productIds.length > 0) {
            // Only update products that are currently 'available' to avoid destructive overwrites
            await trx('products')
              .whereIn('id', productIds)
              .andWhere('status', 'available')
              .update({ status: 'sold', sold_at: trx.fn ? trx.fn.now() : db.fn.now() })
          }
        }

        // Return updated trade
        const final = await trx('trades').where({ id }).first()
        return res.json({ data: final })
      }

      // ...existing handling for other actions (accept/decline/cancel)...
      // For example: await trx('trades').where({id}).update({ status: newStatus })
      // const finalTrade = await trx('trades').where({ id }).first()
      // return res.json({ data: finalTrade })
    })
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message })
    console.error('Trade update error:', err)
    return res.status(500).json({ error: 'Failed to update trade' })
  }
}

module.exports = {
  // ...existing exports...
  updateTrade,
}