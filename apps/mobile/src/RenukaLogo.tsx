import { Image, StyleSheet, type ImageStyle, type StyleProp } from 'react-native';

export function RenukaLogo({
  style,
  decorative = false,
}: {
  style?: StyleProp<ImageStyle>;
  decorative?: boolean;
}) {
  return (
    <Image
      source={require('../assets/cropped-LogoRenuka.jpg')}
      resizeMode="contain"
      accessible={!decorative}
      accessibilityLabel={decorative ? undefined : 'Renuka Safety Solutions'}
      importantForAccessibility={decorative ? 'no' : 'auto'}
      style={[layout.logo, style]}
    />
  );
}

const layout = StyleSheet.create({
  logo: { backgroundColor: '#FFFFFF' },
});
