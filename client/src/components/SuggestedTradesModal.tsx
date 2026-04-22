import React, { useEffect, useState } from 'react';
import {
    Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody,
    VStack, HStack, Text, Image, Button, Spinner, Center, Box, Icon, Badge, useToast, Tooltip
} from '@chakra-ui/react';
import { FaExchangeAlt, FaRegLightbulb, FaHeart, FaQuestionCircle } from 'react-icons/fa';
import { api } from '../services/api';
import { Product } from '../types';
import { getFirstImage } from '../utils/imageUtils';
import { useNavigate } from 'react-router-dom';
import { getProductUrl } from '../utils/productUtils';
interface SuggestedTradesModalProps {
    isOpen: boolean;
    onClose: () => void;
    product: Product | null;
    onTradeClick: (targetProduct: Product) => void;
}

export const SuggestedTradesModal: React.FC<SuggestedTradesModalProps> = ({ isOpen, onClose, product, onTradeClick: _onTradeClick }) => {
    const [suggestions, setSuggestions] = useState<Product[]>([]);
    const [loading, setLoading] = useState(false);
    const [actingId, setActingId] = useState<number | null>(null);
    const [likedIds, setLikedIds] = useState<Set<number>>(new Set());
    const toast = useToast();
    const navigate = useNavigate();

    useEffect(() => {
        if (isOpen && product) {
            try {
                const raw = localStorage.getItem(`trade-likes-${product.id}`);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) {
                        setLikedIds(new Set(parsed.map((id) => Number(id))));
                    } else {
                        setLikedIds(new Set());
                    }
                } else {
                    setLikedIds(new Set());
                }
            } catch {
                setLikedIds(new Set());
            }
            fetchSuggestions();
        }
    }, [isOpen, product]);

    useEffect(() => {
        if (!product) return;
        try {
            localStorage.setItem(`trade-likes-${product.id}`, JSON.stringify(Array.from(likedIds)));
        } catch {
            // Ignore storage errors
        }
    }, [likedIds, product]);

    const fetchSuggestions = async () => {
        try {
            setLoading(true);

            const normalizeCategory = (value?: string): string => {
                const v = (value || '').trim().toLowerCase();
                if (!v) return '';
                if (v === 'other' || v === 'others' || v.startsWith('other')) {
                    return 'other';
                }
                return v;
            };

            // Load full product details so we can reliably read wanted_categories (dashboard listing payload may omit it)
            let desiredCategories: string[] = [];
            try {
                const detailsRes = await api.get(`/api/products/${product!.id}`);
                const raw = detailsRes.data;
                const productData = raw?.data?.product || raw?.data || raw?.product || null;

                const wanted = productData?.wanted_categories;
                if (Array.isArray(wanted)) {
                    desiredCategories = wanted;
                } else if (typeof wanted === 'string' && wanted.trim()) {
                    try {
                        const parsed = JSON.parse(wanted);
                        if (Array.isArray(parsed)) desiredCategories = parsed;
                    } catch {
                        desiredCategories = wanted.split(',').map((s: string) => s.trim()).filter(Boolean);
                    }
                }

                // Fallback to the product's own category when preferences are empty
                if (desiredCategories.length === 0) {
                    const fallback = productData?.category || product?.category;
                    if (fallback) desiredCategories = [fallback];
                }
            } catch {
                // If details request fails, just proceed without client-side filtering
            }

            const desiredSet = new Set(desiredCategories.map(normalizeCategory).filter(Boolean));

            const res = await api.get(`/api/products/${product!.id}/suggested-trades`);
            if (res.data?.success) {
                const incoming: Product[] = Array.isArray(res.data.data) ? res.data.data : [];

                const filtered = desiredSet.size
                    ? incoming.filter((s) => {
                          // Treat empty category as "Other" only when "Other" is desired.
                          const cat = normalizeCategory(s.category);
                          const effective = cat || (desiredSet.has('other') ? 'other' : '');
                          return effective !== '' && desiredSet.has(effective);
                      })
                    : incoming;

                setSuggestions(filtered);
            }
        } catch (err) {
            console.error('Failed to fetch suggested trades', err);
        } finally {
            setLoading(false);
        }
    };

    const handleLike = async (target: Product) => {
        if (!product?.id) return;
        try {
            setActingId(target.id);
            const res = await api.post('/api/trades/likes', {
                liked_product_id: target.id,
                offered_product_id: product.id,
            });
            if (res?.data?.data?.already_liked) {
                setLikedIds((prev) => {
                    const next = new Set(prev);
                    next.add(target.id);
                    return next;
                });
                toast({
                    id: `like-${target.id}`,
                    title: 'Already liked',
                    description: 'You already liked this item for your offer.',
                    status: 'info',
                    duration: 3000,
                    isClosable: true,
                });
                return;
            }
            setLikedIds((prev) => {
                const next = new Set(prev);
                next.add(target.id);
                return next;
            });
            toast({
                id: `like-${target.id}`,
                title: 'Liked!',
                description: 'We notified the owner. If they like your item back, a trade loop will be created.',
                status: 'success',
                duration: 3000,
                isClosable: true,
            });
        } catch (err: any) {
            toast({
                id: `like-error-${target.id}`,
                title: 'Failed to like',
                description: err?.response?.data?.error || 'Please try again.',
                status: 'error',
                duration: 3000,
                isClosable: true,
            });
        } finally {
            setActingId(null);
        }
    };

    const handleUndoLike = async (target: Product) => {
        if (!product?.id) return;
        try {
            setActingId(target.id);
            await api.delete('/api/trades/likes', {
                data: {
                    liked_product_id: target.id,
                    offered_product_id: product.id,
                },
            });
            setLikedIds((prev) => {
                const next = new Set(prev);
                next.delete(target.id);
                return next;
            });
            toast({
                id: `undo-like-${target.id}`,
                title: 'Invite removed',
                description: 'Your trade invite was undone.',
                status: 'success',
                duration: 3000,
                isClosable: true,
            });
        } catch (err: any) {
            toast({
                id: `undo-like-error-${target.id}`,
                title: 'Failed to undo invite',
                description: err?.response?.data?.error || 'Please try again.',
                status: 'error',
                duration: 3000,
                isClosable: true,
            });
        } finally {
            setActingId(null);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside" isCentered>
            <ModalOverlay backdropFilter="blur(4px)" />
            <ModalContent borderRadius="3xl" overflow="hidden" shadow="2xl" mx={4}>
                <ModalHeader bg="white" pt={6} pb={4} pl={6} pr={16}>
                    <HStack spacing={3} w="full">
                        <HStack spacing={3} flex={1} overflow="hidden">
                            <Center minW="40px" w="40px" h="40px" bg="yellow.50" borderRadius="xl">
                                <Icon as={FaRegLightbulb} color="yellow.500" boxSize={5} />
                            </Center>
                            <Text fontSize="xl" fontWeight="800" color="gray.800" letterSpacing="tight" noOfLines={1}>
                                Trade Matches for "{product?.title}"
                            </Text>
                        </HStack>
                        <Box ml="auto">
                            <Tooltip label="Inviting items will notify their owners. If they accept or interact back, your items will connect to form a Trade Loop!" hasArrow placement="bottom-end" bg="gray.800" color="white" px={3} py={2} borderRadius="lg" fontSize="sm" textAlign="center">
                                <Center w={8} h={8} cursor="help" color="brand.500" _hover={{ color: 'brand.600', transform: 'scale(1.1)' }} transition="all 0.2s">
                                    <Icon as={FaQuestionCircle} boxSize={6} />
                                </Center>
                            </Tooltip>
                        </Box>
                    </HStack>
                </ModalHeader>
                <ModalCloseButton top={6} right={6} borderRadius="full" size="lg" />
                <ModalBody p={6} bg="gray.50">
                    {loading ? (
                        <Center py={12}>
                            <Spinner color="brand.500" size="xl" thickness="4px" />
                        </Center>
                    ) : suggestions.length === 0 ? (
                        <Center py={12} flexDir="column" bg="white" borderRadius="2xl" shadow="sm">
                            <Center w="60px" h="60px" bg="gray.50" borderRadius="full" mb={4}>
                                <Icon as={FaExchangeAlt} boxSize={6} color="gray.400" />
                            </Center>
                            <Text color="gray.800" fontWeight="800" fontSize="lg" letterSpacing="tight" mb={1}>No matching trades found.</Text>
                            <Text fontSize="sm" color="gray.500" fontWeight="500">Check back later for new potential deals!</Text>
                        </Center>
                    ) : (
                        <VStack spacing={4} align="stretch" pb={4}>
                            {suggestions.map(s => (
                                <Box 
                                    key={s.id} 
                                    p={4} 
                                    bg="white" 
                                    borderRadius="2xl" 
                                    shadow="sm" 
                                    borderWidth="0" 
                                    _hover={{ shadow: 'md', transform: 'translateY(-2px)', cursor: 'pointer' }} 
                                    transition="all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)"
                                    onClick={() => {
                                        onClose();
                                        navigate(getProductUrl(s));
                                    }}
                                >
                                    <HStack spacing={4} align="start">
                                        <Image
                                            src={getFirstImage(s.image_urls)}
                                            fallbackSrc="/no-image.svg"
                                            boxSize="90px"
                                            objectFit="cover"
                                            borderRadius="xl"
                                        />
                                        <VStack align="start" flex={1} spacing={1} minW={0}>
                                            <Text fontWeight="800" color="gray.800" fontSize="md" noOfLines={1} letterSpacing="tight" wordBreak="break-word">{s.title}</Text>
                                            <HStack spacing={2} wrap="wrap">
                                                {s.category && <Badge bg="brand.50" color="brand.600" borderRadius="md" px={2} py={0.5} fontSize="9px" fontWeight="800" textTransform="uppercase" letterSpacing="wider">{s.category}</Badge>}
                                                {s.condition && <Badge bg="gray.100" color="gray.600" borderRadius="md" px={2} py={0.5} fontSize="9px" fontWeight="800" textTransform="uppercase" letterSpacing="wider">{s.condition}</Badge>}
                                                <Badge bg="yellow.100" color="yellow.700" borderRadius="md" px={2} py={0.5} fontSize="10px" fontWeight="800">₱{Number(s.price || s.estimated_value_min || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Badge>
                                            </HStack>
                                            <Text fontSize="11px" color="gray.500" noOfLines={2} lineHeight="1.3" mt={0.5} wordBreak="break-word">
                                                {s.description || 'No description provided.'}
                                            </Text>
                                            <Text fontSize="10px" color="gray.400" mt={0.5} fontWeight="600" textTransform="uppercase" letterSpacing="wider">By {s.seller_name}</Text>
                                        </VStack>
                                        <Box onClick={(e) => e.stopPropagation()}>
                                            <Tooltip
                                                label={likedIds.has(s.id)
                                                    ? "Undo this invite."
                                                    : "Invite this item for Trade Match or Multi-Way loops."}
                                                hasArrow
                                                placement="top"
                                            >
                                            <Button
                                                size="sm"
                                                bg={likedIds.has(s.id) ? "orange.50" : "red.400"}
                                                color={likedIds.has(s.id) ? "orange.600" : "white"}
                                                leftIcon={<FaHeart />}
                                                borderRadius="xl"
                                                fontWeight="800"
                                                h="36px"
                                                px={4}
                                                shadow={likedIds.has(s.id) ? "none" : "sm"}
                                                onClick={() => likedIds.has(s.id) ? handleUndoLike(s) : handleLike(s)}
                                                isLoading={actingId === s.id}
                                                loadingText={likedIds.has(s.id) ? "Undoing" : "Inviting"}
                                                _hover={likedIds.has(s.id)
                                                    ? { bg: 'orange.100', transform: 'translateY(-1px)' }
                                                    : { bg: 'red.500', transform: 'translateY(-1px)', shadow: 'md' }}
                                                transition="all 0.2s"
                                            >
                                                {likedIds.has(s.id) ? 'Undo Invite' : 'Invite'}
                                            </Button>
                                            </Tooltip>
                                        </Box>
                                    </HStack>
                                </Box>
                            ))}
                        </VStack>
                    )}
                </ModalBody>
            </ModalContent>
        </Modal>
    );
};
