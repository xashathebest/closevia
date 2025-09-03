import React, { useEffect, useMemo, useState } from 'react'
import { Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, VStack, HStack, Box, Image, Text, Badge, Button, Divider, Grid, useToast, ModalFooter } from '@chakra-ui/react'
import { Trade, Product, TradeAction } from '../types'
import { useProducts } from '../contexts/ProductContext'
import { getFirstImage } from '../utils/imageUtils'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../services/api'

interface OfferDetailsModalProps {
  trade: Trade | null
  isOpen: boolean
  onClose: () => void
  onAccepted: () => void
  onDeclined: () => void
}

const OfferDetailsModal: React.FC<OfferDetailsModalProps> = ({ trade, isOpen, onClose, onAccepted, onDeclined }) => {
  const toast = useToast()
  const { getProduct } = useProducts()
  const { user } = useAuth()
  const [requested, setRequested] = useState<Product | null>(null)
  const [offered, setOffered] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [counterOpen, setCounterOpen] = useState(false)
  const [userInventory, setUserInventory] = useState<Product[]>([])
  const [selectedCounterIds, setSelectedCounterIds] = useState<number[]>([])
  const [detailedTrade, setDetailedTrade] = useState<Trade | null>(null)
  const [showDebug, setShowDebug] = useState<boolean>(false)

  // Deep debug logs for data structure analysis
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('🔍 [DEEP DEBUG] FULL TRADE OBJECT:', JSON.stringify(trade, null, 2))
    // eslint-disable-next-line no-console
    console.log('🔍 [DEEP DEBUG] Trade items array:', trade?.items)
    // eslint-disable-next-line no-console
    console.log('🔍 [DEEP DEBUG] Offered array:', offered)
    // eslint-disable-next-line no-console
    console.log('🔍 [DEEP DEBUG] Trade object keys:', trade ? Object.keys(trade as any) : 'null')
  }, [trade])

  // If incoming trade from list lacks items, fetch detailed trade
  useEffect(() => {
    if (!isOpen || !trade) return
    if (!trade.items || trade.items.length === 0) {
      ;(async () => {
        try {
          const res = await api.get(`/api/trades/${trade.id}`)
          const dt: Trade | null = res.data?.data || null
          setDetailedTrade(dt)
          // eslint-disable-next-line no-console
          console.log('🔍 [DEEP DEBUG] Loaded detailed trade:', dt)
        } catch (e) {
          setDetailedTrade(null)
        }
      })()
    } else {
      setDetailedTrade(null)
    }
  }, [isOpen, trade])

  const effectiveTrade = detailedTrade || trade

  // Resilient extraction of buyer-offered items and their product IDs
  const buyerItems = useMemo(() => {
    const items = (effectiveTrade?.items || []) as Array<any>
    return items.filter((i: any) => {
      const offeredBy = (i?.offered_by ?? i?.offeredBy ?? i?.sender ?? i?.from_user_role)
      if (typeof offeredBy === 'string') {
        const v = offeredBy.toLowerCase()
        return v === 'buyer' || v === 'from_buyer' || v === 'sender'
      }
      return false
    })
  }, [effectiveTrade])

  const offeredItemIds = useMemo(() => {
    const ids = buyerItems.map((i: any) => (i?.product_id ?? i?.productId))
    return ids
      .map((x: any) => (typeof x === 'string' ? Number(x) : x))
      .filter((x: any) => typeof x === 'number' && !Number.isNaN(x)) as number[]
  }, [buyerItems])

  useEffect(() => {
    if (!isOpen) return
    // eslint-disable-next-line no-console
    console.log('🔍 [DEEP DEBUG] Derived buyerItems:', buyerItems)
    // eslint-disable-next-line no-console
    console.log('🔍 [DEEP DEBUG] Offered item IDs:', offeredItemIds)
  }, [isOpen, buyerItems, offeredItemIds])

  useEffect(() => {
    if (!isOpen || !effectiveTrade) return
    ;(async () => {
      try {
        setLoading(true)
        const req = await getProduct(effectiveTrade.target_product_id)
        setRequested(req)
        const details: Product[] = []
        for (const pid of offeredItemIds) {
          const p = await getProduct(pid)
          if (p) details.push(p)
        }
        setOffered(details)
      } finally {
        setLoading(false)
      }
    })()
  }, [isOpen, effectiveTrade, getProduct, offeredItemIds])

  const accept = async () => {
    if (!effectiveTrade) return
    try {
      await api.put(`/api/trades/${effectiveTrade.id}`, { action: 'accept' } as TradeAction)
      toast({ title: 'Offer accepted', status: 'success' })
      onAccepted()
      onClose()
    } catch (e: any) {
      toast({ title: 'Failed to accept', description: e?.response?.data?.error || 'Try again', status: 'error' })
    }
  }

  const decline = async () => {
    // Do not immediately close; encourage counter option
    setCounterOpen(true)
  }

  const openCounter = async () => {
    if (!effectiveTrade) return
    try {
      // Load sender (User A) active listings
      const res = await api.get(`/api/products/user/${effectiveTrade.buyer_id}?active=true&page=1&limit=50`)
      const list: Product[] = Array.isArray(res.data?.data?.data) ? res.data.data.data : []
      setUserInventory(list)
      // Preselect current offered items
      setSelectedCounterIds(offeredItemIds)
      setCounterOpen(true)
    } catch {
      setUserInventory([])
      setSelectedCounterIds(offeredItemIds)
      setCounterOpen(true)
    }
  }

  const toggleCounter = (id: number) => {
    setSelectedCounterIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const [cashDelta, setCashDelta] = useState<string>('')
  const [counterMsg, setCounterMsg] = useState<string>('')

  const submitCounter = async () => {
    if (!effectiveTrade) return
    try {
      await api.put(`/api/trades/${effectiveTrade.id}`, { action: 'counter', counter_offered_product_ids: selectedCounterIds, message: counterMsg, counter_offered_cash_amount: cashDelta ? Number(cashDelta) : undefined } as TradeAction)
      toast({ title: 'Counter offer sent', status: 'success' })
      onAccepted()
      onClose()
    } catch (e: any) {
      toast({ title: 'Failed to counter', description: e?.response?.data?.error || 'Try again', status: 'error' })
    }
  }

  // Resolve image URL robustly from various product shapes
  const resolveImage = (p?: Product | null): string | undefined => {
    if (!p) return undefined
    const maybeImgs: any = (p as any).image_urls ?? (p as any).images ?? null
    if (Array.isArray(maybeImgs) && maybeImgs.length > 0) {
      return getFirstImage(maybeImgs)
    }
    if (typeof maybeImgs === 'string' && maybeImgs.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(maybeImgs)
        if (Array.isArray(parsed) && parsed.length > 0) return getFirstImage(parsed)
      } catch {
        // ignore parse error
      }
    }
    if ((p as any).image_url) return (p as any).image_url
    if ((p as any).imageUrl) return (p as any).imageUrl
    return undefined
  }

  const renderProductCard = (p: Product | null, opts?: { compact?: boolean }) => {
    if (!p) return null
    const compact = !!opts?.compact
    const showPrice = !!p.allow_buying && !p.barter_only && typeof p.price === 'number'
    const imageHeight = compact ? '70px' : '130px'
    const padding = compact ? 2 : 3
    const titleSize = compact ? 'sm' : undefined
    const titleFontWeight = compact ? 'semibold' : 'semibold'
    const priceFontSize = compact ? 'sm' : undefined

    const imgSrc = resolveImage(p)
    if (!imgSrc && compact) {
      // eslint-disable-next-line no-console
      console.log(`OfferDetailsModal: product ${p.id} has no image source`)
    }

    return (
      <Box borderWidth="1px" borderColor="gray.200" rounded="md" overflow="hidden">
        <Image src={imgSrc || ''} alt={p.title} w="full" h={imageHeight} objectFit="cover" fallbackSrc="https://via.placeholder.com/400x300?text=No+Image" />
        <Box p={padding}>
          <HStack justify="space-between">
            <Text fontWeight={titleFontWeight} fontSize={titleSize}>{p.title}</Text>
            {/* Show premium only on full (requested) cards, hide for compact (offered) */}
            {p.premium && !compact && <Badge colorScheme="yellow" fontSize={compact ? 'xs' : undefined}>Premium</Badge>}
          </HStack>

          {/* Hide status / barter badges in compact (offered) mode */}
          {!compact && (
            <HStack spacing={2} mt={1}>
              <Badge colorScheme={p.status === 'available' ? 'green' : p.status === 'sold' ? 'red' : 'purple'}>{p.status}</Badge>
              {p.barter_only ? <Badge colorScheme="purple">Barter</Badge> : <Badge colorScheme="blue">For Sale</Badge>}
            </HStack>
          )}

          {/* Hide description in compact mode */}
          {!compact && <Text color="gray.600" mt={2} noOfLines={3}>{p.description}</Text>}

          {showPrice && (
            <Text mt={2} fontWeight="bold" fontSize={priceFontSize}>${(p.price as number).toFixed(2)}</Text>
          )}

          {/* Remove seller info in compact (offered) mode */}
          {!compact && <Text mt={1} fontSize="sm" color="gray.600">Seller: {p.seller_name || `#${p.seller_id}`}</Text>}

          <Button as={'a'} href={`/products/${p.id}`} variant="link" colorScheme="brand" mt={2} size={compact ? 'sm' : 'md'}>View listing</Button>
        </Box>
      </Box>
    )
  }

  const disableAccept = (offeredItemIds.length === 0) && (!effectiveTrade?.offered_cash_amount || effectiveTrade.offered_cash_amount === 0)

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="5xl" isCentered>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader fontSize="md">Offer Details</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          <VStack align="stretch" spacing={4}>
            <HStack align="start" spacing={6}>
              <Box flex={1}>
                <Text fontWeight="bold" mb={2}>Requested Item (yours)</Text>
                {renderProductCard(requested)}
              </Box>
              <Box flex={1}>
                <Text fontWeight="bold" mb={2}>Offered Item(s)</Text>
                <Box>
                  <HStack align="start" spacing={3} flexWrap="wrap">
                    {buyerItems.length > 0 ? (
                      buyerItems.map((item: any, idx: number) => {
                          // Find the product details for this item
                          const product = offered.find(p => p.id === (item.product_id ?? item.productId));
                          return (
                            <Box key={item.id || idx} minW="120px" maxW="100px" flex="1 1 180px">
                              {product ? renderProductCard(product, { compact: true }) : (
                                <Box borderWidth="1px" borderColor="gray.200" rounded="md" p={3} bg="gray.50" minW="80px" maxW="100px">
                                  <Text color="gray.500" fontSize="sm">Product not found (ID: {item.product_id ?? item.productId})</Text>
                                </Box>
                              )}
                            </Box>
                          );
                        })
                    ) : (
                      <Text color="gray.500">No offered items found.</Text>
                    )}
                  </HStack>
                </Box>
              </Box>
            </HStack>


            <HStack spacing={3} mt={2} align="center" wrap="wrap">
              {effectiveTrade?.offered_cash_amount ? (
                <Box borderWidth="1px" borderColor="green.200" bg="green.50" rounded="md" p={2} fontSize="sm" color="green.800" minW="120px">
                  <Text fontWeight="semibold" noOfLines={1}>Cash included</Text>
                  <Text noOfLines={1} color="green.700">₱{Number(effectiveTrade.offered_cash_amount).toFixed(2)}</Text>
                </Box>
              ) : null}

              {showDebug && (
                <Box borderWidth="1px" borderColor="purple.200" bg="purple.50" rounded="md" p={2} fontSize="xs" color="purple.800" minW="140px">
                  <Text fontWeight="semibold" mb={1}>Debug</Text>
                  <Text noOfLines={1}>Items: {trade?.items?.length || 0} • Buyer: {buyerItems.length}</Text>
                </Box>
              )}

              {trade?.message && (
                <Box borderWidth="1px" borderColor="gray.200" bg="gray.50" rounded="md" p={3} fontSize="sm" color="gray.800" flex="1 1 60%" minW="260px">
                  <Text fontWeight="semibold" noOfLines={1}>Message</Text>
                  <Text noOfLines={3} color="gray.700">{trade.message}</Text>
                </Box>
              )}
            </HStack>

            <Divider />

            <HStack justify="space-between" align="center">
              <Box>
                <Text fontWeight="semibold">Trade Summary</Text>
                <Text fontSize="sm" color="gray.600">Your Item(s): 1 • Their Item(s): {offeredItemIds.length}</Text>
                <Text fontSize="sm" color="gray.600">Status: {effectiveTrade?.status}</Text>
                <Text fontSize="sm" color="gray.600">Offered on: {effectiveTrade ? new Date(effectiveTrade.created_at).toLocaleString() : ''}</Text>
              </Box>
              <HStack spacing={3}>
                <Button variant="outline" colorScheme="red" onClick={decline}>Decline</Button>
                <Button colorScheme="green" onClick={accept} isDisabled={disableAccept}>Accept</Button>
                {user && (
                  <Button variant="ghost" onClick={openCounter}>Counter Offer</Button>
                )}
              </HStack>
            </HStack>


            <Modal isOpen={counterOpen} onClose={() => setCounterOpen(false)} isCentered size="xl">
              <ModalOverlay />
              <ModalContent maxW="900px">
                <ModalHeader>Request changes to sender's package</ModalHeader>
                <ModalCloseButton onClick={() => setCounterOpen(false)} />
                <ModalBody>
                  <Grid templateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap={3}>
                    {userInventory.map(p => (
                      <Box key={p.id} borderWidth={selectedCounterIds.includes(p.id) ? '2px' : '1px'} borderColor={selectedCounterIds.includes(p.id) ? 'brand.500' : 'gray.200'} rounded="md" overflow="hidden" onClick={() => toggleCounter(p.id)} cursor="pointer" bg={selectedCounterIds.includes(p.id) ? 'brand.50' : 'white'}>
                        <Image src={getFirstImage(p.image_urls)} alt={p.title} w="full" h="100px" objectFit="cover" />
                        <Box p={2}>
                          <Text fontSize="sm" noOfLines={2}>{p.title}</Text>
                        </Box>
                      </Box>
                    ))}
                  </Grid>
                  <HStack mt={4} spacing={3} align="center">
                    <Box flex={1}>
                      <Text fontSize="sm" color="gray.600" mb={1}>Additional cash requested (PHP)</Text>
                      <input type="number" value={cashDelta} onChange={e => setCashDelta(e.target.value)} min={0} step={0.01 as any} style={{ width: '100%', padding: '8px', border: '1px solid #E2E8F0', borderRadius: 6 }} />
                    </Box>
                    <Box flex={2}>
                      <Text fontSize="sm" color="gray.600" mb={1}>Message (optional)</Text>
                      <input value={counterMsg} onChange={e => setCounterMsg(e.target.value)} placeholder="Please add X..." style={{ width: '100%', padding: '8px', border: '1px solid #E2E8F0', borderRadius: 6 }} />
                    </Box>
                  </HStack>
                </ModalBody>
                <ModalFooter>
                  <Button variant="ghost" mr={3} onClick={() => setCounterOpen(false)}>Cancel</Button>
                  <Button colorScheme="brand" onClick={submitCounter}>Send Counter</Button>
                </ModalFooter>
              </ModalContent>
            </Modal>
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

export default OfferDetailsModal


