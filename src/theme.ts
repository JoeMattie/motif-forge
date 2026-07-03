import { createTheme, type MantineColorsTuple } from '@mantine/core'

/** Workbench accent orange — index 6 ≈ #f14d0e (primary), index 8 ≈ pressed shadow. */
const forge: MantineColorsTuple = [
  '#fff0e8',
  '#ffddca',
  '#ffbf9c',
  '#fc9c68',
  '#f77a3a',
  '#f45f1c',
  '#f14d0e',
  '#d84105',
  '#b93400',
  '#8f2800',
]

// The app sets :root font-size to 13px, so Mantine's rem-based component
// dimensions shrink to ~81% — deliberately compact. Font sizes are pinned in
// px so text stays at the workbench's 13px baseline instead of shrinking too.
// All colors reference the semantic CSS custom properties defined in
// styles.css on :root[data-theme='day' | 'nite'] — Mantine chrome follows the
// hardware panel automatically when the theme flips.
export const theme = createTheme({
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  fontFamilyMonospace: "'IBM Plex Mono', ui-monospace, monospace",
  fontSizes: { xs: '11px', sm: '13px', md: '13px', lg: '15px', xl: '17px' },
  defaultRadius: 'md',
  cursorType: 'pointer',
  primaryColor: 'forge',
  primaryShade: { light: 6, dark: 6 },
  colors: { forge },
  components: {
    // Buttons are the app's hardware keys. The look lives in styles.css under
    // .wb-btn (stamped on every Button root here) so the modifier classes
    // (accent/green/dark/dashed/danger-text, data-latched, data-danger) can
    // override it — filled/outline variants keep Mantine's variant colors.
    Button: {
      defaultProps: { size: 'compact-sm', variant: 'default' },
      classNames: { root: 'wb-btn' },
    },
    ActionIcon: {
      defaultProps: { variant: 'subtle', size: 'sm' },
      classNames: { root: 'wb-action' },
    },
    Kbd: { classNames: { root: 'wb-kbd' } },
    SegmentedControl: {
      defaultProps: { size: 'xs', withItemsBorders: false },
      classNames: {
        root: 'wb-seg',
        indicator: 'wb-seg-indicator',
        label: 'wb-seg-label',
      },
    },
    Drawer: {
      defaultProps: { withCloseButton: false },
      classNames: { content: 'wb-drawer', body: 'wb-drawer-body' },
    },
    TextInput: { defaultProps: { size: 'sm' } },
    Textarea: { defaultProps: { size: 'sm' } },
    NumberInput: { defaultProps: { size: 'sm' } },
    Select: {
      defaultProps: { size: 'sm', allowDeselect: false, comboboxProps: { withinPortal: true } },
    },
    Tooltip: {
      defaultProps: { withArrow: true, openDelay: 300, multiline: true, maw: 340 },
      styles: {
        tooltip: {
          backgroundColor: 'var(--ink)',
          color: 'var(--module-bg)',
          fontSize: '11px',
        },
      },
    },
    Input: {
      styles: {
        input: {
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--surface-border)',
          color: 'var(--ink)',
          boxShadow: 'inset 0 1px 3px rgba(0,0,0,.06)',
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
        },
      },
    },
    InputWrapper: {
      styles: {
        label: {
          color: 'var(--label)',
          fontWeight: 600,
          fontSize: '9.5px',
          letterSpacing: '.12em',
          textTransform: 'uppercase',
          marginBottom: '0.3rem',
        },
      },
    },
    Popover: {
      styles: {
        dropdown: {
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--surface-border)',
          color: 'var(--ink)',
        },
      },
    },
  },
})
