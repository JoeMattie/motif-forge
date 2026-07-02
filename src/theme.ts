import { createTheme, type MantineColorsTuple } from '@mantine/core'

/** Accent teal — index 5 is the bright accent, index 8 the dim variant used for fills. */
const forge: MantineColorsTuple = [
  '#e8faf4',
  '#d0f2e7',
  '#a5e6d1',
  '#79d9ba',
  '#5ecfab',
  '#4fc1a6',
  '#41a78f',
  '#338a76',
  '#2c6e60',
  '#1f5245',
]

/** Grays mapped to the studio palette: 0 = text, 3 = dim text, 5 = borders, 6 = raised, 7 = page. */
const dark: MantineColorsTuple = [
  '#c9cdd6',
  '#aab0bc',
  '#8b92a0',
  '#6f7683',
  '#3a4150',
  '#262a33',
  '#191c23',
  '#111318',
  '#0e1014',
  '#0c0e12',
]

// The app sets :root font-size to 13px, so Mantine's rem-based component
// dimensions shrink to ~81% — deliberately compact. Font sizes are pinned in
// px so text stays at the studio's 13px baseline instead of shrinking too.
export const theme = createTheme({
  fontFamily: "'SF Mono', ui-monospace, 'Cascadia Code', Menlo, monospace",
  fontFamilyMonospace: "'SF Mono', ui-monospace, 'Cascadia Code', Menlo, monospace",
  fontSizes: { xs: '11px', sm: '13px', md: '13px', lg: '15px', xl: '17px' },
  defaultRadius: 'sm',
  cursorType: 'pointer',
  primaryColor: 'forge',
  primaryShade: { light: 6, dark: 8 },
  colors: { forge, dark },
  components: {
    Button: {
      defaultProps: { variant: 'default', size: 'compact-md' },
    },
    TextInput: { defaultProps: { size: 'sm' } },
    Textarea: { defaultProps: { size: 'sm' } },
    NumberInput: { defaultProps: { size: 'sm' } },
    Select: {
      defaultProps: { size: 'sm', allowDeselect: false, comboboxProps: { withinPortal: true } },
    },
    Checkbox: {
      defaultProps: { size: 'sm' },
      styles: { label: { color: 'var(--text-dim)' } },
    },
    Chip: { defaultProps: { size: 'xs' } },
    Fieldset: {
      styles: {
        root: { padding: '0.3rem 0.6rem 0.45rem', backgroundColor: 'transparent' },
        legend: { color: 'var(--text-dim)', padding: '0 0.3rem' },
      },
    },
    Slider: { defaultProps: { size: 'sm' } },
    Badge: { defaultProps: { variant: 'outline', size: 'sm' } },
    Tooltip: {
      defaultProps: { withArrow: true, openDelay: 300, multiline: true, maw: 340 },
    },
    Input: {
      styles: {
        input: { backgroundColor: 'var(--bg)' },
      },
    },
    InputWrapper: {
      styles: {
        label: { color: 'var(--text-dim)', fontWeight: 400, marginBottom: '0.25rem' },
      },
    },
  },
})
