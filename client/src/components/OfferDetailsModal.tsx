import React, { useEffect, useMemo, useState } from 'react'
import { Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, VStack, HStack, Box, Image, Text, Badge, Button, Divider, Grid, useToast, ModalFooter, AlertDialog, AlertDialogOverlay, AlertDialogContent, AlertDialogHeader, AlertDialogBody, AlertDialogFooter, useDisclosure, Icon, Card, CardBody, useColorModeValue, FormControl, FormLabel, Textarea, Input } from '@chakra-ui/react'
import { FaMapMarkerAlt, FaTruck, FaHandshake, FaChevronLeft, FaChevronRight, FaClock, FaCalendarAlt, FaCheckCircle } from 'react-icons/fa'
import { formatPHP } from '../utils/currency'
import { Trade, Product, TradeAction, TradeOption } from '../types'
import { useProducts } from '../contexts/ProductContext'
import { getFirstImage } from '../utils/imageUtils'
import { getProductUrl } from '../utils/productUtils'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../services/api'

interface OfferDetailsModalProps {
  trade: Trade | null
  isOpen: boolean
  onClose: () => void
  onAccepted: (action?: 'accept' | 'counter') => void
  onDeclined: () => void
}

const OfferDetailsModal: React.FC<OfferDetailsModalProps> = ({ trade, isOpen, onClose, onAccepted, onDeclined }) => {
  const toast = useToast()
  const { getProduct } = useProducts()
  const { user } = useAuth()
  const [requestedProducts, setRequestedProducts] = useState<Product[]>([])
  const [additionalRequested, setAdditionalRequested] = useState<Product[]>([])
  const [offered, setOffered] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [counterOpen, setCounterOpen] = useState(false)
  const [userInventory, setUserInventory] = useState<Product[]>([])
  const [selectedCounterIds, setSelectedCounterIds] = useState<number[]>([])
  const [detailedTrade, setDetailedTrade] = useState<Trade | null>(null)
  const [showDebug, setShowDebug] = useState<boolean>(false)
  const [showOptionChangeModal, setShowOptionChangeModal] = useState(false)
  const [requestedOption, setRequestedOption] = useState<TradeOption | null>(null)
  const [requestedDeliveryAddress, setRequestedDeliveryAddress] = useState<string>('')
  const [requestingOptionChange, setRequestingOptionChange] = useState(false)
  const [isAccepting, setIsAccepting] = useState(false)
  const [isDeclining, setIsDeclining] = useState(false)
  const [isCountering, setIsCountering] = useState(false)
  const [showSuggestTime, setShowSuggestTime] = useState(false)
  const [suggestDate, setSuggestDate] = useState('')
  const [suggestStartTime, setSuggestStartTime] = useState('')
  const [suggestEndTime, setSuggestEndTime] = useState('')
  const [isSuggestingTime, setIsSuggestingTime] = useState(false)
  const [isAcceptingTime, setIsAcceptingTime] = useState(false)
  const [isAcceptingSuggestion, setIsAcceptingSuggestion] = useState(false)
  const [isDecliningeSuggestion, setIsDecliningeSuggestion] = useState(false)

  // Build instant placeholder products from trade data to avoid blink
  const buildPlaceholderProduct = (id: number, title?: string, imageUrl?: string): Product => ({
    id,
    title: title || `Product #${id}`,
    description: '',
    status: 'available',
    seller_id: 0,
    image_urls: imageUrl ? [imageUrl] : [],
    created_at: '',
    updated_at: '',
  } as Product)

  // If incoming trade from list lacks items, fetch detailed trade
  useEffect(() => {
    if (!isOpen || !trade) return
    const tradeId = Number(trade.id)
    if ((!trade.items || trade.items.length === 0) && Number.isInteger(tradeId) && tradeId > 0) {
      ;(async () => {
        try {
          const res = await api.get(`/api/trades/${tradeId}`)
          const dt: Trade | null = res.data?.data || null
          setDetailedTrade(dt)
        } catch (e) {
          setDetailedTrade(null)
        }
      })()
    } else {
      setDetailedTrade(null)
    }
  }, [isOpen, trade])

  const effectiveTrade = detailedTrade || trade
  const isPickupFlow = effectiveTrade?.meeting_type === 'pickup'
  const flowLabel = isPickupFlow ? 'Pickup' : 'Meetup'
  const flowLabelLower = isPickupFlow ? 'pickup' : 'meetup'
  const needsUserAcceptance = Boolean(
    effectiveTrade?.status === 'accepted_by_one' &&
    user?.id &&
    ((effectiveTrade.buyer_id === user.id && !effectiveTrade.buyer_accepted) ||
      (effectiveTrade.seller_id === user.id && !effectiveTrade.seller_accepted))
  )
  const canRespondToOffer = Boolean(
    ((effectiveTrade?.status === 'pending' || effectiveTrade?.status === 'pending_multiway') && effectiveTrade?.seller_id === user?.id) ||
    needsUserAcceptance ||
    (effectiveTrade?.status === 'countered' && effectiveTrade?.countered_by !== user?.id)
  )

  const hasPendingSuggestion = Boolean(
    effectiveTrade?.suggestion_status === 'pending_time_confirmation' && effectiveTrade?.suggested_date
  )
  const isTimeSuggestionRecipient = hasPendingSuggestion && effectiveTrade?.suggested_by_user_id !== user?.id
  const isTimeSuggestionSender = hasPendingSuggestion && effectiveTrade?.suggested_by_user_id === user?.id

  const activeOfferRole = useMemo(() => {
    if (!effectiveTrade) return 'buyer'
    if (effectiveTrade.status === 'countered') {
      return effectiveTrade.countered_by === effectiveTrade.seller_id ? 'seller' : 'buyer'
    }
    return 'buyer'
  }, [effectiveTrade])

  // Resilient extraction of the items that belong to the currently active offer.
  const activeOfferItems = useMemo(() => {
    const items = (effectiveTrade?.items || []) as Array<any>
    const filtered = items.filter((i: any) => {
      const offeredBy = (i?.offered_by ?? i?.offeredBy ?? i?.sender ?? i?.from_user_role)
      if (typeof offeredBy === 'string') {
        const v = offeredBy.toLowerCase().trim()
        if (activeOfferRole === 'seller') {
          return v === 'seller' || v === 'from_seller'
        }
        return v === 'buyer' || v === 'from_buyer' || v === 'sender'
      }
      return false
    })
    return filtered
  }, [effectiveTrade, activeOfferRole])
  const requestedTradeItems = useMemo(() => {
    const items = (effectiveTrade?.items || []) as Array<any>
    return items.filter((i: any) => {
      const offeredBy = (i?.offered_by ?? i?.offeredBy ?? i?.sender ?? i?.from_user_role)
      if (typeof offeredBy !== 'string') return false
      const v = offeredBy.toLowerCase().trim()
      return v === 'seller' || v === 'from_seller'
    })
  }, [effectiveTrade])
  const offeredItemIds = useMemo(() => {
    const ids = activeOfferItems.map((i: any) => {
      const pid = (i?.product_id ?? i?.productId)
      return typeof pid === 'string' ? Number(pid) : pid
    })
    const filtered = ids
      .filter((x: any) => typeof x === 'number' && !Number.isNaN(x)) as number[]
    return filtered
  }, [activeOfferItems])
  const requestedItemIds = useMemo(() => {
    const ids: number[] = []
    const seen = new Set<number>()
    const targetId = Number(effectiveTrade?.target_product_id || 0)
    if (targetId > 0) {
      ids.push(targetId)
      seen.add(targetId)
    }
    requestedTradeItems.forEach((item: any) => {
      const pid = Number(item?.product_id ?? item?.productId)
      if (pid > 0 && !seen.has(pid)) {
        seen.add(pid)
        ids.push(pid)
      }
    })
    return ids
  }, [effectiveTrade, requestedTradeItems])
  const requested = requestedProducts[0] || null
  const todayInputValue = () => {
    const now = new Date()
    const yyyy = now.getFullYear()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }
  const parseLocalDateTime = (dateValue: string, timeValue: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue)
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue)
    if (!match || !timeMatch) return null
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(timeMatch[1]),
      Number(timeMatch[2]),
      0,
      0,
    )
  }
  const buildProposalDateTime = (dateValue?: string, timeValue?: string) => {
    const date = (dateValue || '').trim()
    const time = (timeValue || '').trim()
    const parsed = parseLocalDateTime(date, time)
    if (!parsed || Number.isNaN(parsed.getTime())) {
      return { value: '', error: `Please choose a valid ${flowLabelLower} date and time.` }
    }
    if (parsed <= new Date()) {
      return { value: '', error: `Please choose a future ${flowLabelLower} time.` }
    }
    return { value: `${date}T${time}:00`, error: '' }
  }
  const formatTimeLabel = (value?: string) => {
    if (!value) return ''
    const [h, m = '00'] = value.split(':').map(Number)
    if (!Number.isFinite(h)) return value
    const ampm = h >= 12 ? 'PM' : 'AM'
    const hour = h % 12 || 12
    return `${hour}:${String(Number.isFinite(m) ? m : 0).padStart(2, '0')} ${ampm}`
  }
  const formatDateLabel = (value?: string) => {
    if (!value) return ''
    const parsed = new Date(`${value}T00:00:00`)
    if (Number.isNaN(parsed.getTime())) return value
    return parsed.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  const buildProposalWindow = (dateValue?: string, startValue?: string, endValue?: string) => {
    const date = (dateValue || '').trim()
    const start = (startValue || '').trim()
    const end = (endValue || '').trim()
    if (!date) return { error: 'Choose a suggestion date.' }
    if (!start || !end) return { error: 'Choose a start and end time.' }
    if (start >= end) return { error: 'End time must be after start time.' }
    const today = todayInputValue()
    if (date < today) return { error: 'Choose today or a future date.' }
    const windowEnd = parseLocalDateTime(date, end)
    if (!windowEnd || Number.isNaN(windowEnd.getTime())) return { error: `Please choose a valid ${flowLabelLower} window.` }
    if (windowEnd <= new Date()) return { error: 'This time window has already ended.' }
    return { date, start, end, error: '' }
  }
  const getValidTradeID = () => {
    const id = Number(effectiveTrade?.id)
    return Number.isInteger(id) && id > 0 ? id : null
  }
  const isPendingOffer = (status?: string) => ['pending', 'pending_multiway', 'countered', 'accepted_by_one'].includes(status || '')

  // Immediately set placeholder data from trade object (no API call needed)
  useEffect(() => {
    if (!isOpen || !effectiveTrade) return

    // Instant placeholders for requested (target + seller-side bundle) products
    const tradeAny = effectiveTrade as any
    const targetImg = tradeAny.product_image_url || tradeAny.productImageUrl || ''
    const targetTitle = effectiveTrade.product_title || ''
    const requestedPlaceholders = requestedItemIds.map((pid) => {
      if (pid === effectiveTrade.target_product_id) {
        return buildPlaceholderProduct(pid, targetTitle, targetImg)
      }
      const match = requestedTradeItems.find((item: any) => Number(item.product_id ?? item.productId) === pid)
      return buildPlaceholderProduct(pid, match?.product_title ?? match?.productTitle, match?.product_image_url ?? match?.productImageUrl)
    })
    setRequestedProducts(requestedPlaceholders.filter((p) => p.id > 0))

    // Instant placeholders for offered items
    if (activeOfferItems.length > 0) {
      const placeholders = activeOfferItems.map((item: any) => {
        const pid = item.product_id ?? item.productId
        const pTitle = item.product_title ?? item.productTitle ?? ''
        const pImg = item.product_image_url ?? item.productImageUrl ?? ''
        return buildPlaceholderProduct(Number(pid), pTitle, pImg)
      }).filter((p: Product) => p.id > 0)
      if (placeholders.length > 0) {
        setOffered(placeholders)
      }
    }

    // Instant placeholders for additional seller-side target products (multi-target mode)
    const sellerSideItems = (effectiveTrade.items || []).filter((i: any) => {
      const ob = (i?.offered_by ?? i?.offeredBy ?? '').toLowerCase()
      return ob === 'seller'
    })
    if (sellerSideItems.length > 0) {
      const sellerPlaceholders = sellerSideItems.map((item: any) => {
        const pid = item.product_id ?? item.productId
        const pTitle = item.product_title ?? item.productTitle ?? ''
        const pImg = item.product_image_url ?? item.productImageUrl ?? ''
        return buildPlaceholderProduct(Number(pid), pTitle, pImg)
      }).filter((p: Product) => p.id > 0)
      if (sellerPlaceholders.length > 0) {
        setAdditionalRequested(sellerPlaceholders)
      }
    } else {
      setAdditionalRequested([])
    }
  }, [isOpen, effectiveTrade, activeOfferItems])

  // Then fetch full product details in background (upgrades placeholder data)
  useEffect(() => {
    if (!isOpen || !effectiveTrade) return
    ;(async () => {
      try {
        setLoading(true)
        const requestedDetails = await Promise.all(requestedItemIds.map((pid) => getProduct(pid)))
        setRequestedProducts(requestedDetails.filter(Boolean) as Product[])
        const details: Product[] = []
        for (const pid of offeredItemIds) {
          const p = await getProduct(pid)
          if (p) details.push(p)
        }
        setOffered(details)

        // Fetch full details for additional seller-side target products (multi-target mode)
        const sellerSideItems = (effectiveTrade.items || []).filter((i: any) => {
          const ob = (i?.offered_by ?? i?.offeredBy ?? '').toLowerCase()
          return ob === 'seller'
        })
        const sellerDetails: Product[] = []
        for (const item of sellerSideItems) {
          const pid = item.product_id ?? (item as any).productId
          if (pid && Number(pid) !== effectiveTrade.target_product_id) {
            const p = await getProduct(Number(pid))
            if (p) sellerDetails.push(p)
          }
        }
        setAdditionalRequested(sellerDetails)
      } finally {
        setLoading(false)
      }
    })()
  }, [isOpen, effectiveTrade, getProduct, offeredItemIds, requestedItemIds])

  const accept = async () => {
    if (!effectiveTrade || isAccepting) return
    try {
      setIsAccepting(true)
      await api.put(`/api/trades/${effectiveTrade.id}`, { action: 'accept' } as TradeAction)
      toast({
        id: "offerdetailsmodal-offer-accepted", title: 'Offer accepted', status: 'success' })
      onAccepted('accept')
      onClose()
    } catch (e: any) {
      toast({
        id: "offerdetailsmodal-failed-to-accept", title: "Couldn't accept the offer", description: e?.response?.data?.error || 'Something went wrong. Please try again.', status: 'error' })
    } finally {
      setIsAccepting(false)
    }
  }

  const acceptMeetupTime = async () => {
    if (!effectiveTrade || isAcceptingTime) return
    const tradeID = getValidTradeID()
    const proposal = buildProposalDateTime(effectiveTrade.meetup_date, effectiveTrade.meetup_time)
    if (!tradeID || proposal.error) {
      if (import.meta.env.DEV) {
        console.warn('[OfferDetailsModal] Cannot accept meetup time', { trade: effectiveTrade, tradeID, proposal })
      }
      toast({ id: 'odm-time-accept-missing-data', title: `Couldn't confirm ${flowLabelLower} time`, description: proposal.error || "We couldn't find this offer's details. Please refresh and try again.", status: 'error' })
      return
    }
    try {
      setIsAcceptingTime(true)
      if (import.meta.env.DEV) {
        console.debug('[OfferDetailsModal] Accepting proposed time', { tradeID, proposed_time: proposal.value, status: effectiveTrade.status })
      }
      await api.post(`/api/trades/${tradeID}/meetup/propose`, {
        proposed_time: proposal.value,
        proposed_location: effectiveTrade.meetup_location || '',
      })
      const isPendingOffer = ['pending', 'pending_multiway', 'countered'].includes(effectiveTrade.status)
      toast({
        id: 'odm-time-accepted',
        title: `${flowLabel} time accepted`,
        description: isPendingOffer
          ? `Both parties agreed on the ${flowLabelLower} time. The offer is still pending until accepted.`
          : `Both parties agreed on the ${flowLabelLower} time — trade is now ongoing!`,
        status: 'success',
      })
      onAccepted()
      onClose()
    } catch (e: any) {
      toast({ id: 'odm-time-accept-fail', title: `Couldn't confirm ${flowLabelLower} time`, description: e?.response?.data?.error || 'Something went wrong. Please try again.', status: 'error' })
    } finally {
      setIsAcceptingTime(false)
    }
  }

  const acceptTimeSuggestion = async () => {
    if (!effectiveTrade || isAcceptingSuggestion) return
    const offerID = getValidTradeID()
    if (!offerID) {
      toast({ id: 'odm-accept-sugg-missing', title: "Couldn't accept suggestion", description: 'Invalid offer. Please refresh and try again.', status: 'error' })
      return
    }
    try {
      setIsAcceptingSuggestion(true)
      const res = await api.post(`/api/offers/${offerID}/time-suggestion/accept`)
      const updated = res.data?.data || null
      if (updated && effectiveTrade) {
        setDetailedTrade({ ...(effectiveTrade as Trade), ...updated })
      }
      toast({ id: 'odm-sugg-accepted', title: 'Time suggestion accepted', description: 'The offer schedule has been updated to the suggested time.', status: 'success' })
      onAccepted()
    } catch (e: any) {
      toast({ id: 'odm-sugg-accept-fail', title: "Couldn't accept suggestion", description: e?.response?.data?.error || 'Something went wrong. Please try again.', status: 'error' })
    } finally {
      setIsAcceptingSuggestion(false)
    }
  }

  const declineTimeSuggestion = async () => {
    if (!effectiveTrade || isDecliningeSuggestion) return
    const offerID = getValidTradeID()
    if (!offerID) {
      toast({ id: 'odm-decline-sugg-missing', title: "Couldn't decline suggestion", description: 'Invalid offer. Please refresh and try again.', status: 'error' })
      return
    }
    try {
      setIsDecliningeSuggestion(true)
      const res = await api.post(`/api/offers/${offerID}/time-suggestion/decline`)
      const updated = res.data?.data || null
      if (effectiveTrade) {
        setDetailedTrade({ ...(effectiveTrade as Trade), ...(updated || {}), suggested_date: '', suggested_start_time: '', suggested_end_time: '', suggestion_status: 'declined' })
      }
      toast({ id: 'odm-sugg-declined', title: 'Time suggestion declined', description: 'The original schedule remains in effect.', status: 'info' })
      onAccepted()
    } catch (e: any) {
      toast({ id: 'odm-sugg-decline-fail', title: "Couldn't decline suggestion", description: e?.response?.data?.error || 'Something went wrong. Please try again.', status: 'error' })
    } finally {
      setIsDecliningeSuggestion(false)
    }
  }

  const suggestAnotherTime = async () => {
    if (!effectiveTrade || isSuggestingTime) return
    const offerID = getValidTradeID()
    const windowProposal = buildProposalWindow(suggestDate, suggestStartTime, suggestEndTime)
    if (!offerID || windowProposal.error) {
      if (import.meta.env.DEV) {
        console.warn('[OfferDetailsModal] Cannot suggest offer time', { offer: effectiveTrade, offerID, windowProposal })
      }
      if (toast.isActive('odm-time-suggest-missing-data')) toast.close('odm-time-suggest-missing-data')
      toast({ id: 'odm-time-suggest-missing-data', title: "Couldn't suggest a time", description: windowProposal.error || "We couldn't find this offer's details. Please refresh and try again.", status: 'error' })
      return
    }
    try {
      setIsSuggestingTime(true)
      const suggestionType = isPickupFlow ? 'pickup' : 'meetup'
      let updated: any = null
      if (isPendingOffer(effectiveTrade.status)) {
        if (import.meta.env.DEV) {
          console.debug('[OfferDetailsModal] Suggesting pending offer time', { offerID, suggestionType, windowProposal, status: effectiveTrade.status })
        }
        const res = await api.post(`/api/offers/${offerID}/time-suggestion`, {
          suggested_date: windowProposal.date,
          suggested_start_time: windowProposal.start,
          suggested_end_time: windowProposal.end,
          suggestion_type: suggestionType,
        })
        updated = res.data?.data || null
      } else {
        const proposal = buildProposalDateTime(suggestDate, suggestStartTime)
        if (proposal.error) throw new Error(proposal.error)
        if (import.meta.env.DEV) {
          console.debug('[OfferDetailsModal] Suggesting active trade time', { tradeID: offerID, proposed_time: proposal.value, status: effectiveTrade.status })
        }
        await api.post(`/api/trades/${offerID}/meetup/propose`, {
          proposed_time: proposal.value,
          proposed_location: effectiveTrade.meetup_location || '',
        })
        updated = {
          suggested_date: windowProposal.date,
          suggested_start_time: windowProposal.start,
          suggested_end_time: windowProposal.end,
          suggested_by_user_id: user?.id,
          suggestion_status: 'pending_time_confirmation',
          suggestion_type: suggestionType,
        }
      }
      if (updated && effectiveTrade) {
        setDetailedTrade({ ...(effectiveTrade as Trade), ...updated })
      }
      if (toast.isActive('odm-time-suggested')) toast.close('odm-time-suggested')
      toast({ id: 'odm-time-suggested', title: 'New time suggested', description: 'The other trader will be notified.', status: 'success' })
      setShowSuggestTime(false)
      setSuggestDate('')
      setSuggestStartTime('')
      setSuggestEndTime('')
      onAccepted()
    } catch (e: any) {
      if (toast.isActive('odm-time-suggest-fail')) toast.close('odm-time-suggest-fail')
      toast({ id: 'odm-time-suggest-fail', title: "Couldn't suggest a time", description: e?.response?.data?.error || e?.message || 'Something went wrong. Please try again.', status: 'error' })
    } finally {
      setIsSuggestingTime(false)
    }
  }

  const decline = async () => {
    onDeclineOpen()
  }

  const confirmDecline = async () => {
    if (!effectiveTrade || isDeclining) return
    try {
      setIsDeclining(true)
      await api.put(`/api/trades/${effectiveTrade.id}`, { action: 'decline' } as TradeAction)
      toast({
        id: "offerdetailsmodal-offer-declined", title: 'Offer declined', status: 'success' })
      onDeclined()
      onClose()
      onDeclineClose()
    } catch (e: any) {
      toast({
        id: "offerdetailsmodal-failed-to-decline", title: "Couldn't decline the offer", description: e?.response?.data?.error || 'Something went wrong. Please try again.', status: 'error' })
    } finally {
      setIsDeclining(false)
    }
  }

  const openCounter = async () => {
    if (!effectiveTrade) return
    
    // Reset form fields
    setCashDelta('')
    setCounterMsg('')
    
    try {
      // Load sender (User A) active listings
      const res = await api.get(`/api/products/user/${effectiveTrade.buyer_id}?active=true&page=1&limit=50`)
      const list: Product[] = Array.isArray(res.data?.data?.data) ? res.data.data.data : []
      setUserInventory(list)
      
      // For buyout trades, don't preselect items (they don't have items anyway)
      // For regular trades, preselect current offered items
      if (!isBuyout) {
        setSelectedCounterIds(offeredItemIds)
      } else {
        setSelectedCounterIds([])
      }
      setCounterOpen(true)
    } catch {
      setUserInventory([])
      setSelectedCounterIds(isBuyout ? [] : offeredItemIds)
      setCounterOpen(true)
    }
  }

  const toggleCounter = (id: number) => {
    setSelectedCounterIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(x => x !== id)
      }
      
      const limit = requested?.max_items_per_offer || 0
      if (limit > 0 && prev.length >= limit) {
        toast({
          id: 'offerdetailsmodal-selection-limit',
          title: 'Selection Limit Reached',
          description: `You can only select up to ${limit} items for this trade.`,
          status: 'warning',
          duration: 3000,
          isClosable: true,
        })
        return prev
      }
      
      return [...prev, id]
    })
  }

  const [cashDelta, setCashDelta] = useState<string>('')
  const [counterMsg, setCounterMsg] = useState<string>('')
  const { isOpen: isDeclineOpen, onOpen: onDeclineOpen, onClose: onDeclineClose } = useDisclosure()
  const cancelRef = React.useRef<HTMLButtonElement>(null)

  // Check if this is a buyout trade (no items offered, only cash)
  const isBuyout = useMemo(() => {
    return (!effectiveTrade?.items || effectiveTrade.items.length === 0) && 
           (effectiveTrade?.offered_cash_amount && effectiveTrade.offered_cash_amount > 0)
  }, [effectiveTrade])

  const submitCounter = async () => {
    if (!effectiveTrade || isCountering) return
    try {
      setIsCountering(true)
      await api.put(`/api/trades/${effectiveTrade.id}`, { action: 'counter', counter_offered_product_ids: selectedCounterIds, message: counterMsg, counter_offered_cash_amount: cashDelta ? Number(cashDelta) : undefined } as TradeAction)
      toast({
        id: "offerdetailsmodal-counter-offer-sent", title: 'Counter offer sent', status: 'success' })
      onAccepted('counter')
      onClose()
    } catch (e: any) {
      toast({
        id: "offerdetailsmodal-failed-to-counter", title: "Couldn't send counter-offer", description: e?.response?.data?.error || 'Something went wrong. Please try again.', status: 'error' })
    } finally {
      setIsCountering(false)
    }
  }

  // Option change request functionality
  const canRequestOptionChange = () => {
    if (!effectiveTrade || !user) return false
    // Only allow option change before trade is ongoing (status is pending or accepted, but not active)
    const isPendingOrAccepted = effectiveTrade.status === 'pending' || effectiveTrade.status === 'accepted'
    // Only buyer can request option change (since seller set the initial option)
    const isBuyer = effectiveTrade.buyer_id === user.id
    // Don't allow if there's already a pending change request
    const hasPendingRequest = !!effectiveTrade.option_change_requested
    return isPendingOrAccepted && isBuyer && !hasPendingRequest
  }

  const requestOptionChange = async () => {
    if (!effectiveTrade || !requestedOption) return
    if (requestedOption === 'delivery' && !requestedDeliveryAddress.trim()) {
      toast({
        id: "offerdetailsmodal-delivery-address-required", title: 'Delivery address required', description: 'Please provide a delivery address for delivery option.', status: 'warning' })
      return
    }
    try {
      setRequestingOptionChange(true)
      await api.put(`/api/trades/${effectiveTrade.id}`, {
        action: 'request_option_change',
        requested_option: requestedOption,
        delivery_address: requestedOption === 'delivery' ? requestedDeliveryAddress : undefined,
      } as TradeAction)
      toast({
        id: "offerdetailsmodal-option-change-requested", 
        title: 'Option change requested', 
        description: 'The trader will be notified of your request to change the trade option.', 
        status: 'success' 
      })
      setShowOptionChangeModal(false)
      setRequestedOption(null)
      setRequestedDeliveryAddress('')
      onAccepted() // Refresh trade data
    } catch (e: any) {
      toast({
        id: "offerdetailsmodal-failed-to-request-change", title: "Couldn't request that change", description: e?.response?.data?.error || 'Something went wrong. Please try again.', status: 'error' })
    } finally {
      setRequestingOptionChange(false)
    }
  }

  const approveOptionChange = async () => {
    if (!effectiveTrade) return
    try {
      await api.put(`/api/trades/${effectiveTrade.id}`, {
        action: 'approve_option_change',
      } as TradeAction)
      toast({
        id: "offerdetailsmodal-option-change-approved", title: 'Option change approved', description: 'The trade option has been updated.', status: 'success' })
      onAccepted() // Refresh trade data
    } catch (e: any) {
      toast({
        id: "offerdetailsmodal-failed-to-approve-change", title: "Couldn't approve that change", description: e?.response?.data?.error || 'Something went wrong. Please try again.', status: 'error' })
    }
  }

  const rejectOptionChange = async () => {
    if (!effectiveTrade) return
    try {
      await api.put(`/api/trades/${effectiveTrade.id}`, {
        action: 'reject_option_change',
      } as TradeAction)
      toast({
        id: "offerdetailsmodal-option-change-rejected", title: 'Option change rejected', description: 'The trade will proceed with the original option.', status: 'success' })
      onAccepted() // Refresh trade data
    } catch (e: any) {
      toast({
        id: "offerdetailsmodal-failed-to-reject-change", title: "Couldn't reject that change", description: e?.response?.data?.error || 'Something went wrong. Please try again.', status: 'error' })
    }
  }

  const isUserSeller = effectiveTrade && user && effectiveTrade.seller_id === user.id
  const hasPendingOptionChange = !!effectiveTrade?.option_change_requested

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

  const renderProductSummary = (p: Product | null, label: string, fallback?: { title?: string; image?: string; id?: number | string }) => {
    const title = p?.title || fallback?.title || 'Item not available'
    const imgSrc = p ? resolveImage(p) : fallback?.image
    const href = p ? getProductUrl(p) : fallback?.id ? `/products/${fallback.id}` : undefined
    const showPrice = !!p?.allow_buying && !p?.barter_only && typeof p?.price === 'number'

    return (
      <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" bg="white" p={2}>
        <HStack align="center" spacing={2.5}>
          <Box w="58px" h="58px" borderRadius="md" overflow="hidden" bg="gray.100" flexShrink={0}>
            <Image src={imgSrc || ''} alt={title} w="100%" h="100%" objectFit="cover" fallbackSrc="/no-image.svg" />
          </Box>
          <VStack align="start" spacing={0.5} flex={1} minW={0}>
            <Text fontSize="9px" color="gray.500" fontWeight="bold" textTransform="uppercase">{label}</Text>
            <Text fontSize="sm" fontWeight="semibold" color="gray.900" noOfLines={1}>{title}</Text>
            {showPrice && <Text fontSize="xs" color="brand.600" fontWeight="bold">{formatPHP(p.price as number)}</Text>}
          </VStack>
          {href && (
            <Button as="a" href={href} size="xs" variant="ghost" colorScheme="brand" flexShrink={0}>
              View
            </Button>
          )}
        </HStack>
      </Box>
    )
  }

  const disableAccept = (offeredItemIds.length === 0) && (!effectiveTrade?.offered_cash_amount || effectiveTrade.offered_cash_amount === 0)

  return (
    <Modal isOpen={isOpen} onClose={onClose} size={{ base: 'sm', md: 'lg' }} isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent mx={{ base: 3, md: 0 }} maxH={{ base: '88vh', md: '90vh' }} display="flex" flexDirection="column" bg="white" borderRadius={{ base: 'xl', md: 'lg' }} boxShadow="lg">
        {/* Compact Header */}
        <Box bg="white" borderBottomWidth="1px" borderColor="gray.200" p={2.5}>
          <HStack justify="space-between" align="center">
            <VStack align="start" spacing={0}>
              <Text fontSize="base" fontWeight="bold" color="gray.900">Offer Details</Text>
              <Badge 
                colorScheme={
                  effectiveTrade?.status === 'pending' ? 'yellow' : 
                  effectiveTrade?.status === 'accepted' ? 'green' : 
                  effectiveTrade?.status === 'declined' ? 'red' : 
                  effectiveTrade?.status === 'countered' ? 'purple' : 'gray'
                } 
                fontSize="xs"
              >
                {effectiveTrade?.status === 'countered' 
                  ? (effectiveTrade?.countered_by === user?.id ? 'COUNTER-OFFER SENT' : 'COUNTER-OFFER RECEIVED')
                  : (effectiveTrade?.status ? effectiveTrade.status.replace(/_/g, ' ').toUpperCase() : 'UNKNOWN')
                }
              </Badge>
            </VStack>
            <ModalCloseButton position="static" />
          </HStack>
        </Box>

        {/* Scrollable Content */}
        <ModalBody p={3} overflowY="auto" flex={1}>
          <VStack align="stretch" spacing={3}>
            {/* User Info Section */}
            <Box p={3} bg="gray.50" borderRadius="lg" borderWidth="1px" borderColor="gray.200">
              <Text fontSize="10px" fontWeight="bold" color="gray.500" mb={2} textTransform="uppercase" letterSpacing="wider">Trade Participant</Text>
              <HStack align="center" justify="space-between">
                <HStack spacing={3}>
                  <Box p={2} bg="brand.100" color="brand.600" borderRadius="full">
                    <Icon as={effectiveTrade?.buyer_id === user?.id ? FaChevronRight : FaChevronLeft} boxSize={3} />
                  </Box>
                  <VStack align="start" spacing={0}>
                    <Text fontSize="10px" color="gray.500">{effectiveTrade?.buyer_id === user?.id ? 'You sent offer to' : 'Offer received from'}</Text>
                    <Text fontWeight="bold" fontSize="13px" color="gray.800">
                      {effectiveTrade?.buyer_id === user?.id ? effectiveTrade?.seller_name : effectiveTrade?.buyer_name}
                    </Text>
                  </VStack>
                </HStack>
                <VStack align="end" spacing={1}>
                  <Badge variant="subtle" colorScheme="gray" fontSize="9px">
                    <Text as="span" mr={1}>📍</Text>
                    {effectiveTrade?.target_product_pickup_address ||
                      (isPickupFlow ? 'No pickup location set' : (effectiveTrade?.meetup_location || 'No location set'))}
                  </Badge>
                </VStack>
              </HStack>
            </Box>

            {/* Proposed schedule section */}
            {(effectiveTrade?.meetup_date || effectiveTrade?.meetup_time || canRespondToOffer) && (
              <Box p={3} bg="teal.50" borderRadius="lg" borderWidth="1px" borderColor="teal.200">
                <HStack mb={2} spacing={2}>
                  <Icon as={FaCalendarAlt} color="teal.600" boxSize={3.5} />
                  <Text fontSize="10px" fontWeight="bold" color="teal.700" textTransform="uppercase" letterSpacing="wider">
                    Proposed {flowLabel}
                  </Text>
                  <Badge colorScheme="teal" fontSize="8px">
                    {effectiveTrade?.buyer_id === user?.id ? 'You proposed' : `${effectiveTrade?.buyer_name || 'Buyer'} proposed`}
                  </Badge>
                </HStack>

                <Grid templateColumns="1fr 1fr" gap={2} mb={2}>
                  {effectiveTrade?.meetup_date && (
                    <VStack align="start" spacing={0}>
                      <Text fontSize="9px" fontWeight="bold" color="teal.600" textTransform="uppercase">Date</Text>
                      <Text fontSize="12px" fontWeight="semibold" color="teal.900">
                        {new Date(`${effectiveTrade.meetup_date}T00:00:00`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </Text>
                    </VStack>
                  )}
                  {effectiveTrade?.meetup_time && (
                    <VStack align="start" spacing={0}>
                      <Text fontSize="9px" fontWeight="bold" color="teal.600" textTransform="uppercase">Time</Text>
                      <Text fontSize="12px" fontWeight="semibold" color="teal.900">
                        {(() => {
                          const [h, m] = effectiveTrade.meetup_time.split(':').map(Number)
                          const ampm = h >= 12 ? 'PM' : 'AM'
                          const hour = h % 12 || 12
                          return `${hour}:${String(m || 0).padStart(2, '0')} ${ampm}`
                        })()}
                      </Text>
                    </VStack>
                  )}
                  {effectiveTrade?.meetup_location && (
                    <VStack align="start" spacing={0} gridColumn="span 2">
                      <Text fontSize="9px" fontWeight="bold" color="teal.600" textTransform="uppercase">Location</Text>
                      <Text fontSize="11px" color="teal.800" noOfLines={2}>
                        📍 {effectiveTrade.meetup_location}
                      </Text>
                    </VStack>
                  )}
                </Grid>

                {/* Accept / Suggest Another Time — shown only to the non-proposer when no pending suggestion */}
                {effectiveTrade?.buyer_id !== user?.id && !showSuggestTime && !isTimeSuggestionSender && (
                  isTimeSuggestionRecipient ? (
                    <Text fontSize="10px" color="orange.600" fontStyle="italic" mt={1}>
                      A new time was suggested — see below to respond.
                    </Text>
                  ) : (
                    <HStack spacing={2} mt={1}>
                      {(effectiveTrade?.meetup_date && effectiveTrade?.meetup_time) && (
                        <Button
                          size="xs"
                          colorScheme="teal"
                          leftIcon={<Icon as={FaCheckCircle} boxSize={3} />}
                          fontSize="11px"
                          isLoading={isAcceptingTime}
                          onClick={acceptMeetupTime}
                        >
                          Accept This Time
                        </Button>
                      )}
                      <Button
                        size="xs"
                        variant="outline"
                        colorScheme="teal"
                        leftIcon={<Icon as={FaClock} boxSize={3} />}
                        fontSize="11px"
                        onClick={() => setShowSuggestTime(true)}
                      >
                        Suggest Another Time
                      </Button>
                    </HStack>
                  )
                )}
                {isTimeSuggestionSender && !showSuggestTime && (
                  <Text fontSize="10px" color="orange.600" fontStyle="italic" mt={1}>
                    You suggested a new time — waiting for the other party to respond.
                  </Text>
                )}

                {/* Suggest Another Time form */}
                {showSuggestTime && (
                  <VStack align="stretch" spacing={2} mt={2} p={2} bg="white" borderRadius="md" borderWidth="1px" borderColor="teal.200">
                    <Text fontSize="10px" fontWeight="semibold" color="teal.700">Propose a different {flowLabelLower} time:</Text>
                    <HStack spacing={2}>
                      <Input
                        type="date"
                        value={suggestDate}
                        onChange={e => setSuggestDate(e.target.value)}
                        min={todayInputValue()}
                        size="xs"
                        fontSize="11px"
                        flex={1}
                      />
                      <Input
                        type="time"
                        value={suggestStartTime}
                        onChange={e => setSuggestStartTime(e.target.value)}
                        size="xs"
                        fontSize="11px"
                        flex={1}
                      />
                      <Input
                        type="time"
                        value={suggestEndTime}
                        onChange={e => setSuggestEndTime(e.target.value)}
                        size="xs"
                        fontSize="11px"
                        flex={1}
                      />
                    </HStack>
                    <Text fontSize="9px" color="teal.700">
                      {suggestDate && suggestStartTime && suggestEndTime
                        ? `Suggested ${flowLabelLower}: ${formatDateLabel(suggestDate)} · ${formatTimeLabel(suggestStartTime)} - ${formatTimeLabel(suggestEndTime)}`
                        : `Suggest a new ${flowLabelLower} window for this offer.`}
                    </Text>
                    {buildProposalWindow(suggestDate, suggestStartTime, suggestEndTime).error && (suggestDate || suggestStartTime || suggestEndTime) && (
                      <Text fontSize="9px" color="red.500">{buildProposalWindow(suggestDate, suggestStartTime, suggestEndTime).error}</Text>
                    )}
                    <HStack spacing={2}>
                      <Button size="xs" colorScheme="teal" fontSize="10px" isLoading={isSuggestingTime} isDisabled={isSuggestingTime || Boolean(buildProposalWindow(suggestDate, suggestStartTime, suggestEndTime).error)} onClick={suggestAnotherTime}>
                        Send Suggestion
                      </Button>
                      <Button size="xs" variant="ghost" fontSize="10px" onClick={() => { setShowSuggestTime(false); setSuggestDate(''); setSuggestStartTime(''); setSuggestEndTime('') }}>
                        Cancel
                      </Button>
                    </HStack>
                  </VStack>
                )}
              </Box>
            )}

            {effectiveTrade?.suggested_date && effectiveTrade?.suggested_start_time && effectiveTrade?.suggested_end_time && effectiveTrade?.suggestion_status === 'pending_time_confirmation' && (
              <Box p={2.5} bg={isTimeSuggestionRecipient ? 'orange.50' : 'yellow.50'} borderRadius="md" borderWidth="1px" borderColor={isTimeSuggestionRecipient ? 'orange.300' : 'yellow.300'}>
                <HStack justify="space-between" align="start" spacing={2} mb={isTimeSuggestionRecipient ? 2 : 0}>
                  <VStack align="start" spacing={0.5}>
                    <Text fontSize="10px" fontWeight="bold" color={isTimeSuggestionRecipient ? 'orange.700' : 'yellow.700'} textTransform="uppercase">
                      Suggested {effectiveTrade.suggestion_type || flowLabelLower} window
                    </Text>
                    <Text fontSize="12px" fontWeight="semibold" color={isTimeSuggestionRecipient ? 'orange.900' : 'yellow.900'}>
                      {formatDateLabel(effectiveTrade.suggested_date)} · {formatTimeLabel(effectiveTrade.suggested_start_time)} – {formatTimeLabel(effectiveTrade.suggested_end_time)}
                    </Text>
                  </VStack>
                  <Badge colorScheme={isTimeSuggestionRecipient ? 'orange' : 'yellow'} fontSize="8px">
                    {isTimeSuggestionRecipient ? 'Needs your response' : 'Waiting for response'}
                  </Badge>
                </HStack>
                {isTimeSuggestionRecipient && (
                  <HStack spacing={2} mt={1}>
                    <Button
                      size="xs"
                      colorScheme="green"
                      leftIcon={<Icon as={FaCheckCircle} boxSize={3} />}
                      fontSize="11px"
                      isLoading={isAcceptingSuggestion}
                      isDisabled={isDecliningeSuggestion}
                      onClick={acceptTimeSuggestion}
                    >
                      Accept Suggested Time
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      colorScheme="red"
                      fontSize="11px"
                      isLoading={isDecliningeSuggestion}
                      isDisabled={isAcceptingSuggestion}
                      onClick={declineTimeSuggestion}
                    >
                      Decline
                    </Button>
                  </HStack>
                )}
                {isTimeSuggestionSender && (
                  <Text fontSize="10px" color="yellow.700" fontStyle="italic" mt={1}>
                    Waiting for the other user to accept or decline your suggestion.
                  </Text>
                )}
              </Box>
            )}

            {/* Offer Details Section - Compact 2-Column Info Grid */}
            <Box p={2.5} bg="white" borderRadius="md" borderWidth="1px" borderColor="gray.200">
              <Text fontSize="10px" fontWeight="bold" color="gray.700" mb={2} textTransform="uppercase">Offer Details</Text>
              <Grid templateColumns="1fr 1fr" gap={2}>
                {/* Sent timestamp */}
                <VStack align="start" spacing={0.5}>
                  <Text fontSize="9px" fontWeight="bold" color="gray.500" textTransform="uppercase">Sent</Text>
                  <Text fontSize="11px" color="gray.800" fontWeight="semibold">
                    {effectiveTrade?.created_at 
                      ? new Date(effectiveTrade.created_at).toLocaleDateString('en-PH', { 
                          month: 'short', 
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })
                      : 'N/A'
                    }
                  </Text>
                </VStack>

                {/* Cash amount or pure trade */}
                {effectiveTrade?.offered_cash_amount && effectiveTrade.offered_cash_amount > 0 ? (
                  <VStack align="start" spacing={0.5}>
                    <Text fontSize="9px" fontWeight="bold" color="gray.500" textTransform="uppercase">Cash Offer</Text>
                    <Text fontSize="11px" color="green.700" fontWeight="bold">
                      {formatPHP(effectiveTrade.offered_cash_amount)}
                    </Text>
                  </VStack>
                ) : (
                  <VStack align="start" spacing={0.5}>
                    <Text fontSize="9px" fontWeight="bold" color="gray.500" textTransform="uppercase">Offer Type</Text>
                    <Text fontSize="11px" color="gray.600">
                      Pure trade
                    </Text>
                  </VStack>
                )}

                {/* Payment method, when available */}
                {effectiveTrade?.payment_method && (
                  <VStack align="start" spacing={0.5}>
                    <Text fontSize="9px" fontWeight="bold" color="gray.500" textTransform="uppercase">Payment</Text>
                    <Text fontSize="11px" color="gray.800" fontWeight="semibold" textTransform="capitalize">
                      {effectiveTrade.payment_method}
                    </Text>
                  </VStack>
                )}
              </Grid>
            </Box>

            {/* Counter Offer Info - if status is 'countered' */}
            {effectiveTrade?.status === 'countered' && (
              <Box p={3} bg="purple.50" borderRadius="md" borderWidth="1px" borderColor="purple.200">
                <Text fontSize="sm" fontWeight="bold" color="purple.900" mb={2}>📤 Counter Offer Received</Text>
                <VStack align="start" spacing={2} fontSize="xs" color="purple.800">
                  {isBuyout ? (
                    <>
                      <Text fontWeight="bold">Original Offer: ₱{formatPHP(effectiveTrade?.offered_cash_amount || 0)}</Text>
                      {effectiveTrade?.counter_offered_cash_amount && (
                        <Text fontWeight="bold" color="purple.700">
                          💰 Counter Price: <span style={{ fontSize: '14px', fontWeight: 'bold' }}>₱{formatPHP(effectiveTrade.counter_offered_cash_amount)}</span>
                        </Text>
                      )}
                    </>
                  ) : (
                    <>
                      {effectiveTrade.counter_offered_product_ids && effectiveTrade.counter_offered_product_ids.length > 0 && (
                        <VStack align="start" w="full">
                          <Text fontWeight="bold">Their Items:</Text>
                          <HStack spacing={2} w="full" wrap="wrap">
                            {effectiveTrade.counter_offered_product_ids.map((pid: any) => {
                              const counterProduct = offered.find(p => p.id === pid)
                              return (
                                <Badge key={pid} colorScheme="purple" variant="outline">
                                  {counterProduct?.title || `Product #${pid}`}
                                </Badge>
                              )
                            })}
                          </HStack>
                        </VStack>
                      )}
                      {effectiveTrade.counter_offered_cash_amount && effectiveTrade.counter_offered_cash_amount > 0 && (
                        <Text fontWeight="bold">
                          💰 Additional Cash: ₱{formatPHP(effectiveTrade.counter_offered_cash_amount)}
                        </Text>
                      )}
                    </>
                  )}
                </VStack>
              </Box>
            )}

            {/* Items Comparison - Compact */}
            <Box>
              <Text fontSize="10px" fontWeight="bold" color="gray.700" mb={1.5} textTransform="uppercase">Items</Text>
              {loading ? (
                <Box p={3} bg="gray.50" borderRadius="md" textAlign="center">
                  <Text fontSize="11px" color="gray.500">Loading items...</Text>
                </Box>
              ) : (
                <VStack spacing={2} align="stretch">
                  {requestedProducts.length > 0
                    ? requestedProducts.map((product) => (
                        <Box key={`requested-${product.id}`}>
                          {renderProductSummary(product, 'Requested item')}
                        </Box>
                      ))
                    : <Box p={2} bg="gray.50" borderRadius="md"><Text fontSize="11px" color="gray.500">No requested item</Text></Box>}

                  {activeOfferItems.length > 0 ? activeOfferItems.map((item: any, idx: number) => {
                    const itemId = item.product_id ?? item.productId
                    const product = offered.find(p => p.id === itemId)
                    return (
                      <Box key={item.id || idx}>
                        {renderProductSummary(product || null, 'Offered item', {
                          id: itemId,
                          title: item.product_title || item.productTitle || 'Unknown item',
                          image: item.product_image_url || item.productImageUrl || item.image || '',
                        })}
                      </Box>
                    )
                  }) : (
                    <Box p={2} bg="gray.50" borderRadius="md">
                      <Text fontSize="11px" color="gray.500">No items offered</Text>
                    </Box>
                  )}
                </VStack>
              )}
            </Box>

            {/* Trade Summary */}
            {effectiveTrade?.status === 'completed' && (
              <Box p={2} bg="green.50" borderRadius="md" borderWidth="1px" borderColor="green.200">
                <VStack align="stretch" spacing={1.5} fontSize="11px">
                  <HStack justify="space-between">
                    <Text fontWeight="bold" color="green.900">Trade Summary:</Text>
                  </HStack>
                  {effectiveTrade?.completed_at && (
                    <HStack justify="space-between">
                      <Text color="gray.700">Completed:</Text>
                      <Text fontWeight="semibold" color="gray.900">{new Date(effectiveTrade.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
                    </HStack>
                  )}
                  {/* Show role-aware ratings if available */}
                  {(effectiveTrade.buyer_rating || effectiveTrade.seller_rating) && (
                    <HStack justify="space-between">
                      <Text color="gray.700">Ratings:</Text>
                      <HStack spacing={2}>
                        {effectiveTrade.buyer_rating && (
                          <HStack spacing={0.5}>
                            <Text fontSize="10px" color="gray.600">{isBuyout ? 'Buyer' : 'Trader 1'}:</Text>
                            <Text fontWeight="bold" color="yellow.500">⭐ {effectiveTrade.buyer_rating}/5</Text>
                          </HStack>
                        )}
                        {effectiveTrade.seller_rating && (
                          <HStack spacing={0.5}>
                            <Text fontSize="10px" color="gray.600">{isBuyout ? 'Seller' : 'Trader 2'}:</Text>
                            <Text fontWeight="bold" color="yellow.500">⭐ {effectiveTrade.seller_rating}/5</Text>
                          </HStack>
                        )}
                      </HStack>
                    </HStack>
                  )}
                </VStack>
              </Box>
            )}

            {trade?.message && (
              <Box p={2} bg="gray.50" borderRadius="md" borderWidth="1px" borderColor="gray.200">
                <Text fontSize="10px" fontWeight="bold" color="gray.700" mb={1}>Message</Text>
                <Text fontSize="11px" color="gray.700" lineHeight="1.4" noOfLines={2}>
                  {trade.message}
                </Text>
              </Box>
            )}

            {/* Trade Method */}
            {effectiveTrade?.trade_option && (
              <Box borderRadius="md" bg="brand.50" p={2} borderWidth="1px" borderColor="brand.200">
                <HStack spacing={2}>
                  <Icon as={effectiveTrade.trade_option === 'meetup' ? FaMapMarkerAlt : effectiveTrade.trade_option === 'delivery' ? FaTruck : FaHandshake} boxSize={3.5} color="brand.600" flexShrink={0} />
                  <VStack align="start" spacing={0} flex={1}>
                    <Text fontWeight="semibold" fontSize="12px" color="brand.900">
                      {effectiveTrade.trade_option === 'meetup' ? flowLabel : effectiveTrade.trade_option === 'delivery' ? 'Delivery' : 'Buyout'}
                    </Text>
                    {effectiveTrade.trade_option === 'delivery' && effectiveTrade.delivery_address && (
                      <Text fontSize="10px" color="gray.700">{effectiveTrade.delivery_address}</Text>
                    )}
                    {effectiveTrade.trade_option === 'delivery' && (effectiveTrade as any).delivery_fee !== undefined && (
                      <Text fontSize="10px" color="green.700" fontWeight="semibold">
                        Delivery Fee: {formatPHP((effectiveTrade as any).delivery_fee)}
                      </Text>
                    )}
                  </VStack>
                </HStack>

                {/* Pending Change */}
                {hasPendingOptionChange && effectiveTrade.option_change_requested && (
                  <Box mt={2} pt={2} borderTopWidth="1px" borderColor="brand.200">
                    <Text fontSize="xs" fontWeight="bold" color="brand.700" mb={1}>
                      Pending: {effectiveTrade.option_change_requested === 'meetup' ? flowLabel : 'Delivery'}
                    </Text>
                    {isUserSeller ? (
                      <HStack spacing={2} mt={2}>
                        <Button size="xs" colorScheme="green" onClick={approveOptionChange}>Approve</Button>
                        <Button size="xs" colorScheme="red" variant="outline" onClick={rejectOptionChange}>Reject</Button>
                      </HStack>
                    ) : (
                      <Text fontSize="xs" color="gray.600" fontStyle="italic">{isBuyout ? 'Waiting for seller...' : 'Waiting for the other trader...'}</Text>
                    )}
                  </Box>
                )}

                {canRequestOptionChange() && !hasPendingOptionChange && (
                  <Button size="xs" variant="outline" colorScheme="brand" onClick={() => setShowOptionChangeModal(true)} w="full" mt={2}>
                    Request Change
                  </Button>
                )}
              </Box>
            )}
          </VStack>
        </ModalBody>

        {/* Footer */}
        <Box borderTopWidth="1px" borderColor="gray.200" p={2} bg="white">
          <HStack spacing={1.5} justify="flex-end">
            {canRespondToOffer ? (
              <>
                {/* Decline Button */}
                <Button size="xs" variant="outline" colorScheme="red" onClick={decline} fontSize="11px">
                  Decline
                </Button>

                {/* Counter Back Button */}
                <Button size="xs" variant="outline" colorScheme="brand" onClick={openCounter} fontSize="11px">
                  Counter Back
                </Button>

                {/* Accept Button */}
                <Button size="xs" colorScheme="brand" onClick={accept} isDisabled={disableAccept} fontSize="11px">
                  Accept
                </Button>
              </>
            ) : (
              <Text fontSize="11px" color="gray.500" fontStyle="italic">
                {effectiveTrade?.status === 'countered' && effectiveTrade?.countered_by === user?.id 
                  ? 'Waiting for other party to respond to your counter-offer' 
                  : (effectiveTrade?.buyer_id === user?.id && (effectiveTrade?.status === 'pending' || effectiveTrade?.status === 'pending_multiway'))
                    ? 'No actions available for offers you sent' 
                    : `No actions available for ${effectiveTrade?.status?.replace(/_/g, ' ')} trades`
                }
              </Text>
            )}
          </HStack>
        </Box>

        {/* Counter Modal */}
        <Modal isOpen={counterOpen} onClose={() => setCounterOpen(false)} isCentered size={isBuyout ? "sm" : "md"}>
          <ModalOverlay />
          <ModalContent>
            <ModalHeader fontSize="sm">
              {isBuyout ? 'Counter Buyout Offer' : 'Counter Offer'}
              {!isBuyout && requested?.max_items_per_offer ? (
                <Badge ml={2} colorScheme="brand" variant="subtle" verticalAlign="middle">
                  Max {requested.max_items_per_offer} items
                </Badge>
              ) : null}
            </ModalHeader>
            <ModalCloseButton size="sm" />
            <ModalBody fontSize="sm">
              {isBuyout ? (
                // Buyout counter: only money input
                <VStack spacing={3} align="stretch">
                  <Box p={3} bg="blue.50" borderRadius="md" borderWidth="1px" borderColor="blue.200">
                    <Text fontSize="xs" fontWeight="bold" color="blue.700" mb={2}>Original Offer</Text>
                    <Text fontSize="sm" fontWeight="bold" color="blue.900">
                      ₱{formatPHP(effectiveTrade?.offered_cash_amount || 0)}
                    </Text>
                  </Box>
                  <FormControl isRequired>
                    <FormLabel fontSize="xs" fontWeight="bold">Your Counter Price (PHP)</FormLabel>
                    <input 
                      type="number" 
                      value={cashDelta} 
                      onChange={e => setCashDelta(e.target.value)} 
                      min={0} 
                      step="100" 
                      placeholder="Enter your offer price"
                      style={{ width: '100%', padding: '8px', fontSize: '12px', border: '1px solid #E2E8F0', borderRadius: '4px' }} 
                    />
                  </FormControl>
                  <FormControl>
                    <FormLabel fontSize="xs">Message (optional)</FormLabel>
                    <Textarea 
                      value={counterMsg} 
                      onChange={e => setCounterMsg(e.target.value)} 
                      placeholder="Add a note..." 
                      size="sm" 
                      rows={2}
                    />
                  </FormControl>
                </VStack>
              ) : (
                // Regular trade counter: items + money
                <>
                  {selectedCounterIds.length > 0 && (
                    <Text fontSize="xs" color="brand.500" fontWeight="bold" mb={2}>
                      {selectedCounterIds.length} {requested?.max_items_per_offer ? `/ ${requested.max_items_per_offer}` : ''} items selected
                    </Text>
                  )}
                  <Grid templateColumns="repeat(auto-fill, minmax(70px, 1fr))" gap={1.5}>
                    {userInventory.map(p => (
                      <Box key={p.id} borderWidth={selectedCounterIds.includes(p.id) ? '2px' : '1px'} borderColor={selectedCounterIds.includes(p.id) ? 'brand.500' : 'gray.200'} rounded="md" overflow="hidden" onClick={() => toggleCounter(p.id)} cursor="pointer" bg={selectedCounterIds.includes(p.id) ? 'brand.50' : 'white'} h="100%">
                        <Box w="full" h="50px" bg="gray.50" display="flex" alignItems="center" justifyContent="center" overflow="hidden">
                          <Image src={getFirstImage(p.image_urls)} alt={p.title} w="100%" h="100%" objectFit="contain" loading="lazy" />
                        </Box>
                        <Box p={0.75}>
                          <Text fontSize="10px" noOfLines={1}>{p.title}</Text>
                        </Box>
                      </Box>
                    ))}
                  </Grid>
                  <VStack spacing={2} mt={4}>
                    <FormControl size="sm">
                      <FormLabel fontSize="xs">Add Cash</FormLabel>
                      <input type="number" value={cashDelta} onChange={e => setCashDelta(e.target.value)} min={0} step="100" style={{ width: '100%', padding: '6px', fontSize: '12px', border: '1px solid #E2E8F0', borderRadius: '4px' }} />
                    </FormControl>
                    <FormControl size="sm">
                      <FormLabel fontSize="xs">Message</FormLabel>
                      <input value={counterMsg} onChange={e => setCounterMsg(e.target.value)} placeholder="Optional..." style={{ width: '100%', padding: '6px', fontSize: '12px', border: '1px solid #E2E8F0', borderRadius: '4px' }} />
                    </FormControl>
                  </VStack>
                </>
              )}
            </ModalBody>
            <ModalFooter>
              <Button size="sm" variant="ghost" mr={2} onClick={() => setCounterOpen(false)} isDisabled={isCountering}>Cancel</Button>
              <Button size="sm" colorScheme="brand" onClick={submitCounter} isLoading={isCountering}>Send</Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        {/* Decline Dialog */}
        <AlertDialog isOpen={isDeclineOpen} leastDestructiveRef={cancelRef} onClose={onDeclineClose} isCentered>
          <AlertDialogOverlay>
            <AlertDialogContent>
              <AlertDialogHeader fontSize="sm">Decline Offer?</AlertDialogHeader>
              <AlertDialogBody fontSize="xs">
                You can send a counter offer instead to negotiate.
              </AlertDialogBody>
              <AlertDialogFooter>
                <Button ref={cancelRef} size="sm" onClick={onDeclineClose} isDisabled={isDeclining}>Cancel</Button>
                <Button size="sm" colorScheme="red" onClick={confirmDecline} ml={2} isLoading={isDeclining}>Decline</Button>
                <Button size="sm" colorScheme="brand" variant="outline" onClick={openCounter} ml={2} isDisabled={isDeclining}>Counter</Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialogOverlay>
        </AlertDialog>

        {/* Option Change Modal */}
        <Modal isOpen={showOptionChangeModal} onClose={() => setShowOptionChangeModal(false)} size="sm" isCentered>
          <ModalOverlay />
          <ModalContent>
            <ModalHeader fontSize="sm">Trade Method</ModalHeader>
            <ModalCloseButton size="sm" />
            <ModalBody fontSize="sm">
              <Grid templateColumns="repeat(2, 1fr)" gap={2} mb={4}>
                <Card variant="outline" cursor="pointer" borderWidth={requestedOption === 'meetup' ? '2px' : '1px'} borderColor={requestedOption === 'meetup' ? 'brand.500' : 'gray.200'} bg={requestedOption === 'meetup' ? 'brand.50' : 'white'} onClick={() => setRequestedOption('meetup')}>
                  <CardBody p={2}>
                    <VStack spacing={1} align="center">
                      <Icon as={FaMapMarkerAlt} boxSize={4} color={requestedOption === 'meetup' ? 'brand.600' : 'gray.400'} />
                      <Text fontSize="xs" fontWeight="semibold">Meetup</Text>
                    </VStack>
                  </CardBody>
                </Card>
                <Card variant="outline" cursor="pointer" borderWidth={requestedOption === 'delivery' ? '2px' : '1px'} borderColor={requestedOption === 'delivery' ? 'brand.500' : 'gray.200'} bg={requestedOption === 'delivery' ? 'brand.50' : 'white'} onClick={() => setRequestedOption('delivery')}>
                  <CardBody p={2}>
                    <VStack spacing={1} align="center">
                      <Icon as={FaTruck} boxSize={4} color={requestedOption === 'delivery' ? 'brand.600' : 'gray.400'} />
                      <Text fontSize="xs" fontWeight="semibold">Delivery</Text>
                    </VStack>
                  </CardBody>
                </Card>
              </Grid>
              {requestedOption === 'delivery' && (
                <FormControl isRequired mb={3}>
                  <FormLabel fontSize="xs">Address</FormLabel>
                  <Textarea placeholder="Your address..." value={requestedDeliveryAddress} onChange={(e) => setRequestedDeliveryAddress(e.target.value)} rows={2} size="sm" />
                </FormControl>
              )}
            </ModalBody>
            <ModalFooter>
              <Button size="sm" variant="ghost" mr={2} onClick={() => setShowOptionChangeModal(false)}>Cancel</Button>
              <Button size="sm" colorScheme="brand" onClick={requestOptionChange} isLoading={requestingOptionChange} isDisabled={!requestedOption || (requestedOption === 'delivery' && !requestedDeliveryAddress.trim())}>Request</Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </ModalContent>
    </Modal>
  )
}

export default OfferDetailsModal
