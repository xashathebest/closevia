import { extendTheme } from '@chakra-ui/react'

// Chakra default breakpoints: sm 30em, md 48em, lg 62em, xl 80em, 2xl 96em (1536px)
// Ensure desktop (xl/2xl) is usable; optional custom container for very wide
const breakpoints = {
  sm: '30em',
  md: '48em',
  lg: '62em',
  xl: '80em',
  '2xl': '96em', // 1536px - desktop monitor
}

export const theme = extendTheme({
  breakpoints,
  colors: {
    brand: {
      50: '#e6fffa',
      100: '#b2f5ea',
      200: '#81e6d9',
      300: '#4fd1c5',
      400: '#38b2ac',
      500: '#319795',
      600: '#2c7a7b',
      700: '#285e61',
      800: '#1d4e4f',
      900: '#1a202c',
    },
  },
  fonts: {
    heading: "'Poppins', system-ui, sans-serif",
    body: "'Poppins', system-ui, sans-serif",
  },
  components: {
    Button: {
      baseStyle: {
        transitionProperty: 'transform, box-shadow, background-color, border-color, color, opacity',
        transitionDuration: '180ms',
        transitionTimingFunction: 'ease-out',
        _active: {
          transform: 'scale(0.97)',
          boxShadow: '0 0 0 3px rgba(49, 151, 149, 0.12)',
        },
      },
      defaultProps: {
        colorScheme: 'brand',
      },
    },
    IconButton: {
      baseStyle: {
        transitionProperty: 'transform, background-color, color, opacity',
        transitionDuration: '180ms',
        transitionTimingFunction: 'ease-out',
        _active: {
          transform: 'scale(0.97)',
          boxShadow: '0 0 0 3px rgba(49, 151, 149, 0.12)',
        },
      },
    },
    Modal: {
      defaultProps: {
        motionPreset: 'slideInBottom',
      },
    },
  },
  styles: {
    global: {
      body: {
        bg: 'gray.50',
        color: 'gray.800',
      },
    },
  },
})
