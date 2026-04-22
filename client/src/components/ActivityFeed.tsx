import React, { useEffect, useMemo, useState } from 'react';
import { Box, HStack, Text, Icon, Skeleton } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import { FaExchangeAlt, FaTag, FaMapMarkerAlt } from 'react-icons/fa';
import { api } from '../services/api';

const scrollAnimation = keyframes`
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
`;

interface Activity {
    type: string;
    id: number;
    message: string;
    image_url: string;
    timestamp: string;
}

const ActivityFeed = () => {
    const [activities, setActivities] = useState<Activity[]>(() => {
        try {
            const raw = sessionStorage.getItem('home_activity_feed_cache');
            if (!raw) return [];
            const parsed = JSON.parse(raw) as Activity[];
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    });
    const [isLoading, setIsLoading] = useState(activities.length === 0);

    const renderedActivities = useMemo(() => {
        return activities.map((act) => ({
            ...act,
            timeLabel: new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            icon: act.type === 'trade' ? FaExchangeAlt : act.type === 'near_you' ? FaMapMarkerAlt : FaTag,
            iconColor: act.type === 'near_you' ? 'green.300' : 'yellow.300',
        }));
    }, [activities]);

    useEffect(() => {
        let intervalId: ReturnType<typeof setInterval> | null = null;
        let isMounted = true;
        let inFlight = false;
        let pollLat: number | undefined;
        let pollLng: number | undefined;

        const fetchActivities = async (lat?: number, lng?: number) => {
            if (inFlight) return;
            inFlight = true;
            try {
                const params: Record<string, string> = {};
                if (lat !== undefined && lng !== undefined) {
                    params.lat = lat.toFixed(6);
                    params.lng = lng.toFixed(6);
                }
                const res = await api.get('/api/activities', {
                    params,
                    timeout: 8000,
                });
                if (isMounted && res.data?.success && res.data?.data) {
                    const nextActivities = res.data.data as Activity[];
                    setActivities(nextActivities);
                    sessionStorage.setItem('home_activity_feed_cache', JSON.stringify(nextActivities));
                }
            } catch {
                // Activity feed is non-critical; keep cached content or hide silently.
            } finally {
                if (isMounted) setIsLoading(false);
                inFlight = false;
            }
        };

        const startPolling = () => {
            intervalId = setInterval(() => fetchActivities(pollLat, pollLng), 30000);
        };

        // Fetch immediately so the feed does not wait on geolocation permissions.
        fetchActivities();
        startPolling();

        // Enhance with location in parallel when available.
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    pollLat = pos.coords.latitude;
                    pollLng = pos.coords.longitude;
                    fetchActivities(pollLat, pollLng);
                },
                () => {},
                { enableHighAccuracy: true, timeout: 4000, maximumAge: 60000 }
            );
        }

        return () => {
            isMounted = false;
            if (intervalId) clearInterval(intervalId);
        };
    }, []);

    if (isLoading) {
        return (
            <Box w="full" bgGradient="linear(to-r, brand.600, brand.500)" py={2.5} px={3} borderY="1px solid" borderColor="brand.700" shadow="sm" zIndex={10}>
                <HStack spacing={3} overflow="hidden">
                    <Skeleton h="18px" w={{ base: '42%', md: '28%' }} startColor="whiteAlpha.300" endColor="whiteAlpha.500" borderRadius="md" />
                    <Skeleton h="18px" w={{ base: '36%', md: '24%' }} startColor="whiteAlpha.300" endColor="whiteAlpha.500" borderRadius="md" />
                    <Skeleton h="18px" w={{ base: '30%', md: '20%' }} startColor="whiteAlpha.300" endColor="whiteAlpha.500" borderRadius="md" />
                </HStack>
            </Box>
        );
    }

    if (renderedActivities.length === 0) return null;

    return (
        <Box w="full" bgGradient="linear(to-r, brand.600, brand.500)" color="white" py={2.5} overflow="hidden" position="relative" borderY="1px solid" borderColor="brand.700" shadow="sm" zIndex={10}>
            <Box animation={`${scrollAnimation} ${Math.max(renderedActivities.length * 6, 30)}s linear infinite`} whiteSpace="nowrap" display="inline-flex">
                <HStack spacing={12} display="inline-flex" pr={12}>
                    {renderedActivities.map((act, index) => (
                        <HStack key={`${act.id}-${index}-0`} spacing={2}>
                            <Icon as={act.icon} color={act.iconColor} boxSize={3.5} />
                            <Text fontSize="sm" fontWeight="semibold" letterSpacing="wide">
                                {act.message}
                            </Text>
                            <Text fontSize="xs" color="whiteAlpha.800" ml={1}>
                                {act.timeLabel}
                            </Text>
                        </HStack>
                    ))}
                </HStack>
                <HStack spacing={12} display="inline-flex" pr={12}>
                    {renderedActivities.map((act, index) => (
                        <HStack key={`${act.id}-${index}-1`} spacing={2}>
                            <Icon as={act.icon} color={act.iconColor} boxSize={3.5} />
                            <Text fontSize="sm" fontWeight="semibold" letterSpacing="wide">
                                {act.message}
                            </Text>
                            <Text fontSize="xs" color="whiteAlpha.800" ml={1}>
                                {act.timeLabel}
                            </Text>
                        </HStack>
                    ))}
                </HStack>
            </Box>
        </Box>
    );
};

export default ActivityFeed;
