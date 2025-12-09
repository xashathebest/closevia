# Font Size Persistence Fix - Settings Page Reset Issue

## Problem
When navigating back to the Settings page, the font size dropdown was resetting to "Medium" instead of showing the previously selected size.

## Root Cause
The issue was in the component initialization:
```tsx
// OLD - WRONG
const [fontSize, setFontSize] = useState('medium')  // Always initializes to 'medium'

useEffect(() => {
  // This runs AFTER initial render, causing a flash and state mismatch
  setFontSize(savedFontSize)
}, [])
```

When you navigated back:
1. Component mounts → `fontSize` initialized to `'medium'`
2. UI renders with dropdown showing "medium"
3. useEffect runs → `setFontSize(loadedValue)` triggers re-render
4. But the effect also clears the "unsaved changes" flag incorrectly

## Solution
Initialize the state with localStorage data immediately, before React renders:

```tsx
// NEW - CORRECT
const initializeFontSize = () => {
  try {
    const saved = localStorage.getItem('user_settings')
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed.fontSize) {
        return parsed.fontSize  // Return the saved size immediately
      }
    }
  } catch (e) {
    // ignore
  }
  return 'medium'  // Default fallback
}

// React calls initializeFontSize() ONLY ONCE, before first render
const [fontSize, setFontSize] = useState(initializeFontSize)
```

## How It Works Now

### First Visit:
1. User opens Settings
2. `fontSize` initializes to saved value (or 'medium' if no saved value)
3. Dropdown shows correct value immediately ✅
4. User changes to "Large"
5. Font size saves to localStorage in real-time
6. Page applies new font size immediately

### Returning to Settings:
1. User navigates away from Settings (e.g., to Home page)
2. User navigates back to Settings
3. Component mounts
4. `initializeFontSize()` is called by React
5. It reads "Large" from localStorage
6. `fontSize` state initializes to "Large" 
7. Dropdown shows "Large" immediately ✅
8. Font size is already applied on page (from main.tsx on initial page load)

## Key Improvements

✅ **No state flash** - Correct value from the start  
✅ **No unnecessary re-renders** - Initialization happens once  
✅ **Persistent across navigation** - Returns to Settings with correct value  
✅ **Clean state tracking** - No confusion about "unsaved changes"  
✅ **Fast performance** - Only synchronous localStorage read on mount

## Data Flow Diagram

```
Initial Page Load (main.tsx)
    ↓
Load fontSize from localStorage
Apply to document.documentElement.style.fontSize
    ↓
React App Mounts
    ↓
Settings Component Mounts
    ↓
initializeFontSize() reads from localStorage
    ↓
useState(initializeFontSize) → fontSize state = loaded value
    ↓
UI renders with correct dropdown value
    ↓
User changes dropdown
    ↓
useEffect [fontSize] runs → saves to localStorage + applies to DOM
    ↓
Navigate away and back to Settings
    ↓
Settings Component Mounts (again)
    ↓
initializeFontSize() reads from localStorage (NEW VALUE!)
    ↓
useState(initializeFontSize) → fontSize state = NEW loaded value
    ↓
UI renders with correct dropdown value ✅
```

## Files Modified

- **`client/src/pages/Settings.tsx`**
  - Added `initializeFontSize()` helper function
  - Changed `useState('medium')` to `useState(initializeFontSize)`
  - Simplified the mount useEffect (removed fontSize loading from it)

No changes needed to `main.tsx` - it still works perfectly for applying font size on fresh page loads.

## Testing

1. Go to Settings
2. Change font size to "Large"
3. Verify text gets larger immediately
4. Click on another page (e.g., Home)
5. Click back to Settings
6. **Expected**: Dropdown should show "Large" (not "Medium") ✅
7. Text should remain large ✅
8. Refresh page (Ctrl+R)
9. **Expected**: Font size should still be "Large" ✅
