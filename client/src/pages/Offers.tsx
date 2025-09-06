import React, { useEffect, useMemo, useState, useRef } from 'react'
import { Box, Heading, VStack, HStack, Text, Badge, Button, Spinner, Center, useToast, Tabs, TabList, TabPanels, Tab, TabPanel, Select, Image, Link, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton } from '@chakra-ui/react'
import { api } from '../services/api'
import { Trade, TradeAction } from '../types'
import { getFirstImage } from '../utils/imageUtils'
import OfferDetailsModal from '../components/OfferDetailsModal'

const Offers: React.FC = () => {
  const [incoming, setIncoming] = useState<Trade[]>([])
  const [outgoing, setOutgoing] = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const toast = useToast()

  // New state: confirmation modal flow
  const [confirmTrade, setConfirmTrade] = useState<Trade | null>(null)
  const [confirming, setConfirming] = useState(false)

  const fetchAll = async () => {
    try {
      setLoading(true)
      const [incRes, outRes] = await Promise.all([
        api.get('/api/trades', { params: { direction: 'incoming' } }),
        api.get('/api/trades', { params: { direction: 'outgoing' } }),
      ])
      setIncoming(Array.isArray(incRes.data?.data) ? incRes.data.data : [])
      setOutgoing(Array.isArray(outRes.data?.data) ? outRes.data.data : [])
    } catch (e: any) {
      toast({ title: 'Error', description: e?.response?.data?.error || 'Failed to load offers', status: 'error' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [])

  // Debug: inspect API structure for /api/trades
  useEffect(() => {
    if (!loading) {
      try {
        // eslint-disable-next-line no-console
        console.log('🔍 [TRADE STRUCTURE DEBUG] Incoming trades:', JSON.stringify(incoming.slice(0, 2), null, 2))
        // eslint-disable-next-line no-console
        console.log('🔍 [TRADE STRUCTURE DEBUG] Outgoing trades:', JSON.stringify(outgoing.slice(0, 2), null, 2))
        const sample = incoming[0] || outgoing[0]
        if (sample?.items && sample.items.length > 0) {
          // eslint-disable-next-line no-console
          console.log('🔍 [ITEMS DEBUG] Trade items type:', typeof (sample.items[0] as any))
          // eslint-disable-next-line no-console
          console.log('🔍 [ITEMS DEBUG] First item structure:', sample.items[0])
        }
      } catch {}
    }
  }, [loading, incoming, outgoing])

  // Update updateTrade signature to optionally skip refetch (we keep default behavior unchanged)
  const updateTrade = async (id: number, action: TradeAction, opts?: { refetch?: boolean }) => {
    try {
      await api.put(`/api/trades/${id}`, action)
      toast({ title: 'Success', description: 'Offer updated', status: 'success' })
      if (opts?.refetch ?? true) {
        fetchAll()
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e?.response?.data?.error || 'Failed to update offer', status: 'error' })
    }
  }

  // Helper to replace updated trade into local lists (incoming/outgoing)
  const replaceTradeInLists = (updated: Trade) => {
    setIncoming(prev => prev.map(t => t.id === updated.id ? updated : t))
    setOutgoing(prev => prev.map(t => t.id === updated.id ? updated : t))
    // if we currently have it selected, update the selectedTrade view
    setSelectedTrade(prev => prev && prev.id === updated.id ? updated : prev)
  }

  // New: handle the confirm flow (called when user confirms in modal)
  const handleConfirmTrade = async (t: Trade) => {
    setConfirming(true)
    try {
      // Perform complete action
      await api.put(`/api/trades/${t.id}`, { action: 'complete' })
      // Fetch updated trade (robust if API PUT does not return updated payload)
      const res = await api.get(`/api/trades/${t.id}`)
      const updated: Trade = res.data?.data ?? { ...t }
      // Update local lists with the new trade state (no global fetchAll to avoid UX jumps)
      replaceTradeInLists(updated)

      // Decide message based on confirmation flags or status
      const buyerConfirmed = !!(updated as any).buyer_completed
      const sellerConfirmed = !!(updated as any).seller_completed
      if (buyerConfirmed && sellerConfirmed) {
        toast({ title: 'Trade finalized', description: 'Both parties confirmed. Trade will move to history shortly.', status: 'success' })
      } else {
        toast({ title: 'You\'ve confirmed the trade', description: 'Waiting for the other party to confirm.', status: 'info' })
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e?.response?.data?.error || 'Failed to confirm trade', status: 'error' })
    } finally {
      setConfirming(false)
      setConfirmTrade(null)
    }
  }

  const sortList = (list: Trade[]) => {
    const sorted = [...list]
    sorted.sort((a, b) => {
      const at = new Date(a.created_at).getTime()
      const bt = new Date(b.created_at).getTime()
      return sort === 'newest' ? bt - at : at - bt
    })
    return sorted
  }

  const incomingSorted = useMemo(() => sortList(incoming), [incoming, sort])
  const outgoingSorted = useMemo(() => sortList(outgoing), [outgoing, sort])
  // statuses that should be treated as "history"
  const historyStatuses = ['declined', 'cancelled', 'completed']

  // statuses that should be shown in the In Progress tab only
  const inProgressStatuses = ['accepted', 'active', 'pending_confirmation']

  // visible lists for the two main tabs (exclude history items)
  // Also exclude in-progress trades so they appear only in the "In Progress" tab
  const offersReceivedVisible = incomingSorted.filter(t => !historyStatuses.includes(t.status) && !inProgressStatuses.includes(t.status))
  const offersSentVisible = outgoingSorted.filter(t => !historyStatuses.includes(t.status) && !inProgressStatuses.includes(t.status))

  // Priority ranking: countered first, then pending, then others
  const statusRank = (s?: string) => {
    if (!s) return 3
    const v = s.toLowerCase()
    if (v === 'countered') return 0
    if (v === 'pending') return 1
    return 2
  }

  // Compare by created_at taking the current "sort" (newest | oldest) into account
  const compareDatesBySort = (a: Trade, b: Trade) => {
    const at = new Date(a.created_at).getTime()
    const bt = new Date(b.created_at).getTime()
    return sort === 'newest' ? bt - at : at - bt
  }

  const offersReceivedSorted = useMemo(() => {
    return [...offersReceivedVisible].sort((a, b) => {
      const r = statusRank(a.status) - statusRank(b.status)
      if (r !== 0) return r
      return compareDatesBySort(a, b)
    })
  }, [offersReceivedVisible, sort])

  const offersSentSorted = useMemo(() => {
    return [...offersSentVisible].sort((a, b) => {
      const r = statusRank(a.status) - statusRank(b.status)
      if (r !== 0) return r
      return compareDatesBySort(a, b)
    })
  }, [offersSentVisible, sort])

  // history list: combine history-status trades from incoming+outgoing and tag source for UX
  type SourceTrade = Trade & { source: 'Offers Received' | 'Offers Sent' }
  const historyItems: SourceTrade[] = [
    ...incomingSorted.filter(t => historyStatuses.includes(t.status)).map(t => ({ ...t, source: 'Offers Received' as const })),
    ...outgoingSorted.filter(t => historyStatuses.includes(t.status)).map(t => ({ ...t, source: 'Offers Sent' as const })),
  ]

  // Sort history using current sort direction
  const historyItemsSorted = useMemo(() => {
    return [...historyItems].sort((a, b) => compareDatesBySort(a, b))
  }, [historyItems, sort])

  // Resolve image for an item coming from /api/trades (robust to various shapes)
  const resolveItemImage = (it: any): string | undefined => {
    if (!it) return undefined
    // common single-field
    if (it.product_image_url) return it.product_image_url
    if (it.productImageUrl) return it.productImageUrl
    // combined/title fields might include an array string
    const maybeImgs = it.product_image_urls ?? it.productImages ?? null
    if (Array.isArray(maybeImgs) && maybeImgs.length > 0) return getFirstImage(maybeImgs)
    if (typeof maybeImgs === 'string' && maybeImgs.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(maybeImgs)
        if (Array.isArray(parsed) && parsed.length > 0) return getFirstImage(parsed)
      } catch {}
    }
    return undefined
  }

  // small cache to avoid refetching product details repeatedly
  const productImageCache = useRef<Map<number, string | null>>(new Map())

  // helper component: show thumbnail from existing url or fetch product by id
  const ProductThumb: React.FC<{ pid: number; src?: string; alt?: string }> = ({ pid, src, alt }) => {
    const [img, setImg] = useState<string | null>(src ?? null)

    useEffect(() => {
      let mounted = true
      if (src) {
        setImg(src)
        return
      }
      const cached = productImageCache.current.get(pid)
      if (cached !== undefined) {
        setImg(cached)
        return
      }
      ;(async () => {
        try {
          const res = await api.get(`/api/products/${pid}`)
          const prod = res.data?.data
          const maybeImgs: any = prod?.image_urls ?? prod?.images ?? null
          let resolved: string | undefined
          if (Array.isArray(maybeImgs) && maybeImgs.length > 0) resolved = getFirstImage(maybeImgs)
          else if (typeof maybeImgs === 'string' && maybeImgs.trim().startsWith('[')) {
            try {
              const parsed = JSON.parse(maybeImgs)
              if (Array.isArray(parsed) && parsed.length > 0) resolved = getFirstImage(parsed)
            } catch {}
          } else if (prod?.image_url) resolved = prod.image_url
          else if (prod?.imageUrl) resolved = prod.imageUrl
          if (mounted) {
            productImageCache.current.set(pid, resolved ?? null)
            setImg(resolved ?? null)
          }
        } catch {
          productImageCache.current.set(pid, null)
          if (mounted) setImg(null)
        }
      })()
      return () => { mounted = false }
    }, [pid, src])

    return (
      <Image
        src={img ?? ''}
        alt={alt ?? `#${pid}`}
        boxSize="40px"
        objectFit="cover"
        fallbackSrc="https://via.placeholder.com/40x40?text=?"
      />
    )
  }

  if (loading) {
    return (
      <Center h="50vh"><Spinner size="xl" color="brand.500" /></Center>
    )
  }

  const badgeColor = (status: Trade['status']) => {
    switch (status) {
      case 'pending': return 'yellow'
      case 'accepted': return 'green'
      case 'declined': return 'red'
      case 'pending_confirmation': return 'orange'
      case 'completed': return 'green'
      case 'cancelled': return 'red'
      default: return 'purple'
    }
  }

  const renderOfferedItems = (t: Trade) => {
    const offered = (t.items || []).filter((i: any) => {
      const ob = (i?.offered_by ?? i?.offeredBy ?? i?.sender ?? i?.from_user_role)
      if (typeof ob === 'string') {
        const v = ob.toLowerCase()
        return v === 'buyer' || v === 'from_buyer' || v === 'sender'
      }
      return false
    })
    if (offered.length === 0) return <Text color="gray.500" fontSize="sm">No items attached</Text>
    return (
      <HStack spacing={2} mt={2} wrap="wrap">
        {offered.map((it: any) => {
          const pid = it.product_id ?? it.productId
          const ptitle = it.product_title ?? it.productTitle
          const pimg = it.product_image_url ?? it.productImageUrl
          const pstatus = it.product_status ?? it.productStatus
          return (
            <HStack key={it.id} spacing={2} borderWidth="1px" borderColor="gray.200" rounded="md" p={2} align="center">
              {/* Use ProductThumb: if pimg exists it's used, otherwise it will fetch product by id */}
              <ProductThumb pid={Number(pid)} src={pimg} alt={ptitle || `#${pid}`} />
              <VStack spacing={0} align="start">
                <Link href={`/products/${pid}`} color="brand.600" fontSize="sm">{ptitle || `#${pid}`}</Link>
                <Text fontSize="xs" color="gray.500">{pstatus}</Text>
              </VStack>
            </HStack>
          )
        })}
      </HStack>
    )
  }

  return (
    <Box px={8} py={6} bg="#FFFDF1">
      <HStack justify="space-between" mb={4}>
        <Heading size="md">Offers</Heading>
        <HStack>
          <Text fontSize="sm" color="gray.600">Sort:</Text>
          <Select size="sm" value={sort} onChange={e => setSort(e.target.value as any)} w="160px">
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </Select>
        </HStack>
      </HStack>

      <Tabs colorScheme="brand">
        <TabList>
          <Tab>Offers Received <Badge ml={2}>{incoming.filter(i => i.status === 'pending').length}</Badge></Tab>
          <Tab>Offers Sent <Badge ml={2}>{outgoing.filter(i => i.status === 'pending').length}</Badge></Tab>
          <Tab>In Progress</Tab>
          <Tab>History</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <VStack spacing={4} align="stretch">
              {offersReceivedSorted.length === 0 ? (
                <Text color="gray.500">No offers received.</Text>
              ) : offersReceivedSorted.map((t) => (
                <Box
                  key={t.id}
                  bg="white"
                  borderWidth="1px"
                  borderColor="gray.200"
                  rounded="md"
                  p={4}
                  position="relative" /* enable absolute positioning for actions */
                >
                  {/* Top-right: status */}
                  <Box position="absolute" top={4} right={4}>
                    <Badge colorScheme={badgeColor(t.status)}>{t.status}</Badge>
                  </Box>

                  {/* Left: details with extra right padding so content doesn't collide with absolute actions */}
                  <Box pr="220px">
                    <VStack align="start" spacing={1}>
                      <Text fontWeight="semibold">{t.product_title || `Product #${t.target_product_id}`}</Text>
                      <Text fontSize="sm" color="gray.600">From: {t.buyer_name || `User #${t.buyer_id}`}</Text>
                      <Text fontSize="xs" color="gray.500">{new Date(t.created_at).toLocaleString()}</Text>
                      {renderOfferedItems(t)}
                    </VStack>
                  </Box>

                  {/* Actions positioned bottom-right */}
                  <Box position="absolute" right={4} bottom={4}>
                    <HStack spacing={2}>
                      <Button size="sm" onClick={() => { setSelectedTrade(t); setDetailsOpen(true) }}>View</Button>
                      <Button size="sm" colorScheme="green" onClick={() => updateTrade(t.id, { action: 'accept' })} isDisabled={t.status !== 'pending'}>Accept</Button>
                      <Button size="sm" colorScheme="red" variant="outline" onClick={() => updateTrade(t.id, { action: 'decline' })} isDisabled={t.status !== 'pending'}>Decline</Button>
                    </HStack>
                  </Box>
                </Box>
              ))}
            </VStack>
          </TabPanel>
          <TabPanel>
            <VStack spacing={4} align="stretch">
              {offersSentSorted.length === 0 ? (
                <Text color="gray.500">No offers sent.</Text>
              ) : offersSentSorted.map((t) => (
                <Box key={t.id} bg="white" borderWidth="1px" borderColor="gray.200" rounded="md" p={4}>
                  <HStack justify="space-between" align="start">
                    <VStack align="start" spacing={1}>
                      <Text fontWeight="semibold">{t.product_title || `Product #${t.target_product_id}`}</Text>
                      <Text fontSize="sm" color="gray.600">To: {t.seller_name || `User #${t.seller_id}`}</Text>
                      <Text fontSize="xs" color="gray.500">{new Date(t.created_at).toLocaleString()}</Text>
                      {renderOfferedItems(t)}
                    </VStack>
                    <Badge colorScheme={badgeColor(t.status)}>{t.status}</Badge>
                  </HStack>
                </Box>
              ))}
            </VStack>
          </TabPanel>
          <TabPanel>
            <VStack spacing={4} align="stretch">
              {incomingSorted.concat(outgoingSorted).filter(t => t.status === 'accepted' || t.status === 'active' || t.status === 'pending_confirmation').length === 0 ? (
                <Text color="gray.500">No trades in progress.</Text>
              ) : incomingSorted.concat(outgoingSorted).filter(t => t.status === 'accepted' || t.status === 'active' || t.status === 'pending_confirmation').map((t) => (
                <Box key={t.id} bg="white" borderWidth="1px" borderColor="gray.200" rounded="md" p={4} position="relative">
                  {/* Top-right: status */}
                  <Box position="absolute" top={4} right={4}>
                    <Badge colorScheme={badgeColor(t.status)}>{t.status}</Badge>
                  </Box>

                  {/* Left: details */}
                  <Box pr="220px">
                    <VStack align="start" spacing={1}>
                      <Text fontWeight="semibold">{t.product_title || `Product #${t.target_product_id}`}</Text>
                      <Text fontSize="sm" color="gray.600">Buyer: {t.buyer_name || `#${t.buyer_id}`} • Seller: {t.seller_name || `#${t.seller_id}`}</Text>
                      {renderOfferedItems(t)}
                    </VStack>
                  </Box>

                  {/* Bottom-right actions: Complete button with confirmation status */}
                  <Box position="absolute" right={4} bottom={4}>
                    <VStack spacing={2} align="end">
                      {/* Show confirmation status */}
                      {t.status === 'pending_confirmation' && (
                        <Text fontSize="xs" color="orange.600" fontWeight="semibold">
                          {(t as any).buyer_completed && (t as any).seller_completed ? 'Both confirmed' :
                           (t as any).buyer_completed ? 'Buyer confirmed' :
                           (t as any).seller_completed ? 'Seller confirmed' : 'Awaiting confirmation'}
                        </Text>
                      )}

                      <HStack spacing={2}>
                        <Button
                          size="sm"
                          colorScheme={t.status === 'pending_confirmation' ? 'orange' : 'brand'}
                          onClick={() => {
                            // Open confirmation modal instead of immediately refetching which can shift tabs
                            setConfirmTrade(t)
                          }}
                          isDisabled={['completed', 'cancelled', 'declined'].includes(t.status)}
                          title={t.status === 'pending_confirmation' ?
                            "Confirm this trade. Trade will complete when both parties have confirmed." :
                            "Click to confirm this trade. Waiting for the other party to confirm."}
                        >
                          {t.status === 'pending_confirmation' ? 'Confirm Trade' : 'Complete Trade'}
                        </Button>
                      </HStack>
                    </VStack>
                  </Box>
                </Box>
              ))}
            </VStack>
          </TabPanel>
          <TabPanel>
            <VStack spacing={4} align="stretch">
              {historyItemsSorted.length === 0 ? (
                <Text color="gray.500">No history yet.</Text>
              ) : historyItemsSorted.map((t) => (
                <Box key={t.id} bg="white" borderWidth="1px" borderColor="gray.200" rounded="md" p={4}>
                  <HStack justify="space-between" align="start">
                    <VStack align="start" spacing={1}>
                      <Text fontWeight="semibold">{t.product_title || `Product #${t.target_product_id}`}</Text>
                      <Text fontSize="sm" color="gray.600">Buyer: {t.buyer_name || `#${t.buyer_id}`} • Seller: {t.seller_name || `#${t.seller_id}`}</Text>
                      {renderOfferedItems(t)}
                      {/* source note for UX (where this history item originated) */}
                      <Text fontSize="xs" color="gray.500" mt={1}>Source: {t.source}</Text>
                    </VStack>
                    <Badge colorScheme={badgeColor(t.status)}>{t.status}</Badge>
                  </HStack>
                </Box>
              ))}
            </VStack>
          </TabPanel>
        </TabPanels>
      </Tabs>

      <OfferDetailsModal
        trade={selectedTrade}
        isOpen={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        onAccepted={fetchAll}
        onDeclined={fetchAll}
      />

      {/* Confirmation Modal (opened when user clicks Complete/Confirm) */}
      <Modal isOpen={!!confirmTrade} onClose={() => { if (!confirming) setConfirmTrade(null) }} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{confirmTrade?.status === 'pending_confirmation' ? 'Confirm Trade' : 'Complete Trade'}</ModalHeader>
          <ModalCloseButton disabled={confirming} />
          <ModalBody>
            <VStack align="start" spacing={3}>
              <Text>
                {confirmTrade?.status === 'pending_confirmation'
                  ? 'The other user has already confirmed. By confirming, you will finalize your side of the trade. Once both parties have confirmed the trade will move to history.'
                  : 'You are about to confirm this trade. This will mark you as confirmed. Waiting for the other party to confirm.'}
              </Text>
              <Text fontSize="sm" color="gray.600">
                Buyer: {confirmTrade?.buyer_name || `#${confirmTrade?.buyer_id}`} • Seller: {confirmTrade?.seller_name || `#${confirmTrade?.seller_id}`}
              </Text>
              <HStack spacing={2}>
                <Badge colorScheme={badgeColor(confirmTrade?.status)}>{confirmTrade?.status}</Badge>
                {confirmTrade && (confirmTrade as any).buyer_completed && <Badge colorScheme="green">Buyer confirmed</Badge>}
                {confirmTrade && (confirmTrade as any).seller_completed && <Badge colorScheme="green">Seller confirmed</Badge>}
              </HStack>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button mr={3} onClick={() => setConfirmTrade(null)} isDisabled={confirming}>Cancel</Button>
            <Button colorScheme="orange" onClick={() => confirmTrade && handleConfirmTrade(confirmTrade)} isLoading={confirming}>
              {confirmTrade?.status === 'pending_confirmation' ? 'Confirm Trade' : 'Complete Trade'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  )
}

export default Offers
