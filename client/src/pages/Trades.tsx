import React, { useEffect, useState } from 'react'
import { Box, Heading, VStack, HStack, Text, Badge, Button, Spinner, Center, useToast, Input, Divider, Tabs, TabList, TabPanels, Tab, TabPanel, useColorModeValue } from '@chakra-ui/react'
import { api } from '../services/api'
import { Trade, TradeAction } from '../types'
import TradeLoopsDisplay from '../components/TradeLoopsDisplay'
import TradeLoopNotificationsPanel from '../components/TradeLoopNotificationsPanel'

const Trades: React.FC = () => {
  const [trades, setTrades] = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTabIndex, setActiveTabIndex] = useState(0)
  const toast = useToast()
  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')

  const fetchTrades = async () => {
    try {
      setLoading(true)
      const res = await api.get('/api/trades')
      setTrades(Array.isArray(res.data?.data) ? res.data.data : [])
    } catch (e: any) {
      toast({ title: 'Error', description: e?.response?.data?.error || 'Failed to load trades', status: 'error' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchTrades() }, [])

  const [activeTradeId, setActiveTradeId] = useState<number | null>(null)
  const [messages, setMessages] = useState<Array<{id:number; trade_id:number; sender_id:number; content:string; created_at:string}>>([])
  const [newMessage, setNewMessage] = useState('')

  const openTrade = async (id: number) => {
    setActiveTradeId(id)
    setMessages([])
    try {
      const res = await api.get(`/api/trades/${id}/messages`)
      setMessages(Array.isArray(res.data?.data) ? res.data.data : [])
    } catch {}
  }

  const sendMessage = async () => {
    if (!activeTradeId || !newMessage.trim()) return
    try {
      await api.post(`/api/trades/${activeTradeId}/messages`, { content: newMessage.trim() })
      setNewMessage('')
      const res = await api.get(`/api/trades/${activeTradeId}/messages`)
      setMessages(Array.isArray(res.data?.data) ? res.data.data : [])
    } catch (e:any) {
      toast({ title: 'Error', description: e?.response?.data?.error || 'Failed to send message', status: 'error' })
    }
  }

  const updateTrade = async (id: number, action: TradeAction) => {
    try {
      await api.put(`/api/trades/${id}`, action)
      toast({ title: 'Success', description: 'Trade updated', status: 'success' })
      fetchTrades()
    } catch (e: any) {
      toast({ title: 'Error', description: e?.response?.data?.error || 'Failed to update trade', status: 'error' })
    }
  }

  const handleViewTradeChains = () => {
    setActiveTabIndex(1)
  }

  if (loading) {
    return (
      <Center h="50vh"><Spinner size="xl" color="brand.500" /></Center>
    )
  }

  return (
    <Box px={8} py={6}>
      <Heading size="md" mb={6}>Trades & Multi-Way Trading</Heading>
      
      {/* Trade Loop Notifications Panel */}
      <TradeLoopNotificationsPanel onViewTrades={handleViewTradeChains} />
      
      <Tabs variant="soft-rounded" colorScheme="brand" index={activeTabIndex} onChange={setActiveTabIndex}>
        <TabList mb={4}>
          <Tab>Individual Trades ({trades.length})</Tab>
          <Tab>Multi-Way Opportunities</Tab>
        </TabList>

        <TabPanels>
          {/* Individual Trades Tab */}
          <TabPanel>
            <VStack spacing={4} align="stretch">
              {trades.length === 0 ? (
                <Text color="gray.500">No trades yet.</Text>
              ) : trades.map((t) => (
                <Box key={t.id} bg={cardBg} borderWidth="1px" borderColor={borderColor} rounded="md" p={4}>
                  <HStack justify="space-between" align="start">
                    <VStack align="start" spacing={1}>
                      <Text fontWeight="semibold">Trade #{t.id}</Text>
                      <Text fontSize="sm" color="gray.600">Product: {t.product_title || `#${t.target_product_id}`}</Text>
                      <Text fontSize="sm" color="gray.600">With: {t.buyer_name || t.seller_name || `User #${t.buyer_id}`}</Text>
                      <Text fontSize="sm" color="gray.600">Items offered: {t.items?.length || 0}</Text>
                    </VStack>
                    <Badge colorScheme={t.status === 'pending' ? 'yellow' : t.status === 'accepted' ? 'green' : t.status === 'declined' ? 'red' : 'purple'}>{t.status}</Badge>
                  </HStack>
                  <HStack mt={3} spacing={3}>
                    <Button size="sm" colorScheme="green" variant="outline" onClick={() => updateTrade(t.id, { action: 'accept' })}>Accept</Button>
                    <Button size="sm" colorScheme="red" variant="outline" onClick={() => updateTrade(t.id, { action: 'decline' })}>Decline</Button>
                    <Button size="sm" variant="ghost" onClick={() => openTrade(t.id)}>Open</Button>
                  </HStack>
                  {activeTradeId === t.id && (
                    <Box mt={4}>
                      <Divider mb={3} />
                      <VStack align="stretch" spacing={2} maxH="240px" overflowY="auto">
                        {messages.map((m) => (
                          <Box key={m.id} bg="gray.50" rounded="md" p={2}>
                            <Text fontSize="xs" color="gray.500">{new Date(m.created_at).toLocaleString()}</Text>
                            <Text>{m.content}</Text>
                          </Box>
                        ))}
                        {messages.length === 0 && (
                          <Text color="gray.400">No messages yet.</Text>
                        )}
                      </VStack>
                      <HStack mt={3}>
                        <Input placeholder="Type a message" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sendMessage() }} />
                        <Button onClick={sendMessage} colorScheme="brand">Send</Button>
                      </HStack>
                    </Box>
                  )}
                </Box>
              ))}
            </VStack>
          </TabPanel>

          {/* Multi-Way Trading Tab */}
          <TabPanel>
            <TradeLoopsDisplay />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </Box>
  )
}

export default Trades


