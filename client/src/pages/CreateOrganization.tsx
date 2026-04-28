import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Box,
  Button,
  Container,
  Divider,
  FormControl,
  FormHelperText,
  FormLabel,
  Grid,
  GridItem,
  Heading,
  HStack,
  Image,
  Input,
  Select,
  Stack,
  Text,
  Textarea,
  useToast,
  VStack,
} from '@chakra-ui/react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { getImageUrl } from '../utils/imageUtils'

const ORG_CATEGORIES = [
  'Student Org',
  'Club',
  'Department',
  'Research Group',
  'Community Initiative',
  'Academic Council',
  'Thrift Shop',
  'Barter Items',
  'Goods',
  'Book Swap',
  'Other',
]

const BIO_MAX_LENGTH = 500

const sanitizeHandle = (value: string): string => {
  return value
    .toLowerCase()
    .trim()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

const CreateOrganization: React.FC = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [orgName, setOrgName] = useState(user?.org_name || '')

  const [orgLogoUrl, setOrgLogoUrl] = useState(user?.org_logo_url || '')
  const [orgCoverUrl, setOrgCoverUrl] = useState((user as any)?.org_cover_url || '')
  const [bio, setBio] = useState('')
  const [orgCategory, setOrgCategory] = useState((user as any)?.org_category || '')
  const [orgWebsite, setOrgWebsite] = useState((user as any)?.org_website || '')
  const [orgLocation, setOrgLocation] = useState((user as any)?.org_location || '')
  const [orgContactEmail, setOrgContactEmail] = useState((user as any)?.org_contact_email || '')
  const [saving, setSaving] = useState(false)
  const [quotaLoading, setQuotaLoading] = useState(true)
  const [quota, setQuota] = useState<{ tier: string; limit: number; created: number; can_create: boolean } | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [logoFileName, setLogoFileName] = useState('')
  const [coverFileName, setCoverFileName] = useState('')
  const [showOptionalFields, setShowOptionalFields] = useState(false)

  const previewName = useMemo(() => orgName || 'Your Organization Name', [orgName])
  const previewHandle = useMemo(() => sanitizeHandle(orgName), [orgName])
  const bioLength = bio.length
  const bioCounterColor = bioLength >= BIO_MAX_LENGTH ? 'red.500' : bioLength >= Math.floor(BIO_MAX_LENGTH * 0.8) ? 'orange.500' : 'gray.500'

  useEffect(() => {
    const loadQuota = async () => {
      try {
        const res = await api.get('/api/organizations/quota')
        setQuota((res.data?.data || null) as { tier: string; limit: number; created: number; can_create: boolean } | null)
      } catch {
        setQuota(null)
      } finally {
        setQuotaLoading(false)
      }
    }
    loadQuota()
  }, [])

  const uploadImage = async (file: File, kind: 'profile' | 'organization-cover') => {
    const formData = new FormData()
    formData.append('image', file)
    formData.append('type', kind)

    const res = await api.post('/api/upload', formData, {
      timeout: 30000,
    })

    const url = res.data?.data?.url
    if (!url) {
      throw new Error('Upload failed: missing file URL')
    }
    return url as string
  }

  const onLogoFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setUploadingLogo(true)
    setLogoFileName(file.name)
    try {
      const url = await uploadImage(file, 'profile')
      setOrgLogoUrl(url)
      toast({ title: 'Logo uploaded', status: 'success', duration: 2000 })
    } catch (error: any) {
      toast({ title: "Logo didn't upload", description: error?.message || 'Something went wrong — please try again.', status: 'error' })
    } finally {
      setUploadingLogo(false)
    }
  }

  const onCoverFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setUploadingCover(true)
    setCoverFileName(file.name)
    try {
      const url = await uploadImage(file, 'organization-cover')
      setOrgCoverUrl(url)
      toast({ title: 'Cover uploaded', status: 'success', duration: 2000 })
    } catch (error: any) {
      toast({ title: "Cover didn't upload", description: error?.message || 'Something went wrong — please try again.', status: 'error' })
    } finally {
      setUploadingCover(false)
    }
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!orgName.trim()) {
      toast({ title: "What's your org's name?", description: "Give your organization a name to get started.", status: 'warning', duration: 2500 })
      return
    }
    if (!sanitizeHandle(orgName)) {
      toast({ title: "Let's tweak the name a bit", description: "The name needs at least some letters so we can create a handle for it.", status: 'warning', duration: 2500 })
      return
    }
    if (!orgCategory.trim()) {
      toast({ title: "Pick a category", description: "Choose what best describes your organization.", status: 'warning', duration: 2500 })
      return
    }

    setSaving(true)
    try {
      const normalizedHandle = sanitizeHandle(orgName)
      const res = await api.post('/api/organizations', {
        name: orgName.trim(),
        slug: normalizedHandle,
        description: bio.trim(),
        category: orgCategory,
        logo_url: orgLogoUrl.trim(),
        cover_url: orgCoverUrl.trim(),
      })

      const createdSlug = res.data?.data?.slug || normalizedHandle
      toast({
        title: 'Organization created',
        description: `@${createdSlug} is now live.`,
        status: 'success',
        duration: 2500,
      })
      navigate(`/org/${createdSlug}`)
    } catch (error: any) {
      if (error?.response?.data?.data?.error_code === 'ORG_LIMIT_REACHED') {
        toast({
          title: 'Organization limit reached',
          description: 'Upgrade your tier to create more organizations.',
          status: 'warning',
        })
      }
      toast({
        title: 'Failed to create organization',
        description: error?.response?.data?.error || error?.message || 'Please check your fields and try again.',
        status: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box bg="#FFFDF1" minH="calc(100vh - 64px)">
      <Container maxW="7xl" py={{ base: 6, md: 10 }}>
        <VStack align="stretch" spacing={2} mb={6}>
          <Heading size="lg">Create Organization</Heading>
          <Text color="gray.600">
            Build a topic-focused community page. Members can request access and post after approval.
          </Text>
          {!quotaLoading && quota ? (
            <Text color="gray.600" fontSize="sm">
              Tier: {quota.tier} | Created: {quota.created}/{quota.limit}
            </Text>
          ) : null}
        </VStack>

        {!quotaLoading && quota && !quota.can_create ? (
          <Alert status="warning" borderRadius="lg" bg="yellow.50" borderWidth="1px" borderColor="yellow.200" mb={6}>
            <AlertIcon />
            <Box>
              <AlertTitle>Organization limit reached</AlertTitle>
              <AlertDescription>
                Your current tier allows {quota.limit} organization{quota.limit > 1 ? 's' : ''}. Upgrade to create more.
              </AlertDescription>
            </Box>
          </Alert>
        ) : null}

        <Grid templateColumns={{ base: '1fr', lg: '1.1fr 0.9fr' }} gap={6} alignItems="start" opacity={!quotaLoading && quota && !quota.can_create ? 0.55 : 1} pointerEvents={!quotaLoading && quota && !quota.can_create ? 'none' : 'auto'}>
        <GridItem>
          <Box
            as="form"
            bg="white"
            borderWidth="1px"
            borderColor="gray.200"
            borderRadius="xl"
            onSubmit={onSubmit}
            display="flex"
            flexDirection="column"
            maxH={{ lg: 'calc(100vh - 120px)' }}
            overflow="hidden"
          >
            <Box p={{ base: 4, md: 6 }} overflowY="auto" flex="1">
              <Stack spacing={5}>
                <Text fontSize="xs" color="gray.500">
                  <Text as="span" color="red.500" fontWeight="600">* </Text>
                  Required fields
                </Text>

                <VStack align="stretch" spacing={3}>
                  <Heading size="sm" color="gray.700">Basic Info</Heading>

                  <FormControl isRequired>
                    <FormLabel>Organization Name</FormLabel>
                    <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Eco Student Council" />
                    <FormHelperText mt={1}>
                      <Text as="span" color="gray.500">Profile URL: </Text>
                      <Text as="span" fontFamily="mono" bg="gray.100" px={2} py={0.5} borderRadius="md" color="gray.700">
                        /org/{sanitizeHandle(orgName || 'your-handle')}
                      </Text>
                    </FormHelperText>
                  </FormControl>
                </VStack>

                <Divider borderColor="gray.100" />

                <VStack align="stretch" spacing={3}>
                  <Heading size="sm" color="gray.700">Branding</Heading>

                  <FormControl>
                    <FormLabel>Logo / Avatar</FormLabel>
                    <VStack align="stretch" spacing={2}>
                      <Input id="org-logo-upload" type="file" accept="image/*" display="none" onChange={onLogoFileChange} />
                      <Button as="label" htmlFor="org-logo-upload" variant="outline" isLoading={uploadingLogo} justifyContent="space-between">
                        <Text>Upload logo</Text>
                        <Text fontSize="xs" color="gray.500" noOfLines={1} maxW="60%">{logoFileName || 'No file selected'}</Text>
                      </Button>
                    </VStack>
                  </FormControl>

                  <FormControl>
                    <FormLabel>Cover Photo</FormLabel>
                    <VStack align="stretch" spacing={2}>
                      <Input id="org-cover-upload" type="file" accept="image/*" display="none" onChange={onCoverFileChange} />
                      <Button as="label" htmlFor="org-cover-upload" variant="outline" isLoading={uploadingCover} justifyContent="space-between">
                        <Text>Upload cover</Text>
                        <Text fontSize="xs" color="gray.500" noOfLines={1} maxW="60%">{coverFileName || 'No file selected'}</Text>
                      </Button>
                    </VStack>
                  </FormControl>
                </VStack>

                <Divider borderColor="gray.100" />

                <VStack align="stretch" spacing={3}>
                  <Heading size="sm" color="gray.700">Details</Heading>

                  <FormControl>
                    <FormLabel>About / Description</FormLabel>
                    <Textarea
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      rows={5}
                      maxLength={BIO_MAX_LENGTH}
                      placeholder="What your organization does..."
                    />
                    <HStack justify="space-between" mt={1}>
                      <Text fontSize="xs" color="gray.500">Describe your mission and what members can expect.</Text>
                      <Text fontSize="xs" color={bioCounterColor} fontWeight="600">{bioLength}/{BIO_MAX_LENGTH}</Text>
                    </HStack>
                  </FormControl>

                  <FormControl isRequired>
                    <FormLabel>Category</FormLabel>
                    <Select value={orgCategory} onChange={(e) => setOrgCategory(e.target.value)} placeholder="Select category">
                      {ORG_CATEGORIES.map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </Select>
                  </FormControl>

                  <Button
                    variant="ghost"
                    size="sm"
                    width="100%"
                    onClick={() => setShowOptionalFields(!showOptionalFields)}
                    color="teal.600"
                  >
                    {showOptionalFields ? '- Hide optional fields' : '+ Add optional fields (Website, Location, Email)'}
                  </Button>

                  {showOptionalFields && (
                    <>
                      <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={4}>
                        <FormControl>
                          <FormLabel>Website</FormLabel>
                          <Input value={orgWebsite} onChange={(e) => setOrgWebsite(e.target.value)} placeholder="https://example.org" />
                        </FormControl>
                        <FormControl>
                          <FormLabel>Location</FormLabel>
                          <Input value={orgLocation} onChange={(e) => setOrgLocation(e.target.value)} placeholder="Campus / City" />
                        </FormControl>
                      </Grid>

                      <FormControl>
                        <FormLabel>Contact Email</FormLabel>
                        <Input value={orgContactEmail} onChange={(e) => setOrgContactEmail(e.target.value)} placeholder="contact@org.edu" />
                      </FormControl>
                    </>
                  )}
                </VStack>
              </Stack>
            </Box>

            <Box borderTop="1px solid" borderColor="gray.100" p={{ base: 4, md: 5 }} bg="white" position="sticky" bottom={0}>
              <HStack spacing={3} justify="flex-end">
                <Button variant="ghost" onClick={() => navigate('/dashboard')}>Cancel</Button>
                <Button type="submit" colorScheme="teal" isLoading={saving}>
                  Create Organization
                </Button>
              </HStack>
            </Box>
          </Box>
        </GridItem>

        <GridItem>
          <Box bg="white" borderWidth="1px" borderColor="gray.200" borderRadius="xl" overflow="hidden" position="sticky" top={{ lg: '24px' }}>
            <Box px={5} pt={5} pb={2}>
              <Text fontSize="xs" fontWeight="700" textTransform="uppercase" letterSpacing="wider" color="gray.500">Live preview</Text>
              <Text fontSize="xs" color="gray.400">Updates as you type</Text>
            </Box>
            <Box h="140px" bg="gray.100" position="relative">
              <Image src={getImageUrl(orgCoverUrl || undefined)} alt="Organization cover preview" w="full" h="full" objectFit="cover" />
            </Box>
            <Box p={5} mt="-38px" position="relative">
              <Box w="76px" h="76px" borderRadius="full" overflow="hidden" border="4px solid" borderColor="white" bg="gray.100" mb={3}>
                <Image src={getImageUrl(orgLogoUrl || undefined)} alt="Organization logo preview" w="full" h="full" objectFit="cover" />
              </Box>
              <Heading size="md" mb={1}>{previewName}</Heading>
              <Text color="gray.500" fontSize="sm" mb={2}>@{previewHandle || 'org-name'}</Text>
              <Text fontSize="sm" color="teal.700" mb={3}>{orgCategory || 'Category'}</Text>
              <Text fontSize="sm" color="gray.700" noOfLines={4} mb={3}>
                {bio || 'Your organization description will appear here as you type.'}
              </Text>
              <VStack align="stretch" spacing={1} fontSize="sm" color="gray.600">
                {orgLocation ? <Text>Location: {orgLocation}</Text> : null}
                {orgWebsite ? <Text>Website: {orgWebsite}</Text> : null}
                {orgContactEmail ? <Text>Contact: {orgContactEmail}</Text> : null}
                {!orgLocation && !orgWebsite && !orgContactEmail ? <Text color="gray.400">Optional details will appear here.</Text> : null}
              </VStack>
            </Box>
          </Box>
        </GridItem>
        </Grid>
      </Container>
    </Box>
  )
}

export default CreateOrganization
