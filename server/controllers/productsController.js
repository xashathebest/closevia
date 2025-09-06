const db = require('../db') // knex instance (adjust path if needed)

// Get products for homepage / search
async function listProducts(req, res) {
  try {
    const q = req.query.q || null
    const page = Number(req.query.page || 1)
    const perPage = Math.min(Number(req.query.perPage || 24), 100)

    // Only return products that are currently available
    const base = db('products').where({ status: 'available' })

    if (q) {
      base.andWhere(function () {
        this.where('title', 'like', `%${q}%`).orWhere('description', 'like', `%${q}%`)
      })
    }

    const items = await base
      .select('id', 'title', 'price', 'image_url', 'status')
      .offset((page - 1) * perPage)
      .limit(perPage)

    res.json({ data: items })
  } catch (err) {
    console.error('List products error', err)
    res.status(500).json({ error: 'Failed to load products' })
  }
}

module.exports = {
  // ...existing exports...
  listProducts,
}