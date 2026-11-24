import type { TextStyle, ViewStyle } from 'react-native';

// Shared geometry for action buttons. Filter chips and icon controls keep their
// own shapes; text buttons can grow when accessibility text wraps.
export const actionButton: ViewStyle = {
  minHeight: 52,
  minWidth: 48,
  borderRadius: 16,
  borderWidth: 1,
  borderColor: '#D7BFC3',
  paddingHorizontal: 16,
  paddingVertical: 12,
  alignItems: 'center',
  justifyContent: 'center',
};

export const actionButtonText: TextStyle = {
  color: '#9B1C31',
  fontSize: 16,
  lineHeight: 22,
  fontWeight: '700',
  textAlign: 'center',
  flexShrink: 1,
};
