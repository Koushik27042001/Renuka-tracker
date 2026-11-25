import { useEffect, useRef, useState, type ReactNode } from 'react';
import { colors } from './theme';
import {
  AccessibilityInfo,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function SignInLayout({ children }: { children: ReactNode }) {
  const progress = useRef(new Animated.Value(0)).current;
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    let mounted = true;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (reduce) => {
      setAnimate(!reduce);
    });
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (mounted) setAnimate(!reduce);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!animate) return;
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 550,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [animate, progress]);

  return (
    <SafeAreaView style={signInStyles.screen}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        style={signInStyles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={signInStyles.page}
        >
          <View style={signInStyles.hero}>
            <View pointerEvents="none" style={signInStyles.outerRing} />
            <View pointerEvents="none" style={signInStyles.innerRing} />
            <Animated.View
              style={
                animate
                  ? {
                      transform: [
                        {
                          translateY: progress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [8, 0],
                          }),
                        },
                      ],
                    }
                  : undefined
              }
            >
              <View
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                style={signInStyles.icon}
              >
                <Text style={signInStyles.monogram}>R</Text>
              </View>
            </Animated.View>
            <Text accessibilityRole="header" style={signInStyles.title}>
              Rss hrms desk
            </Text>
            <Text style={signInStyles.subtitle}>
              Check in for your shift, log field visits, and review your attendance.
            </Text>
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export const signInStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ivory },
  keyboard: { flex: 1 },
  page: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 20,
    width: '100%',
    maxWidth: 540,
    alignSelf: 'center',
  },
  hero: {
    overflow: 'hidden',
    backgroundColor: colors.forest,
    borderRadius: 22,
    padding: 24,
    gap: 10,
  },
  outerRing: {
    position: 'absolute',
    width: 230,
    height: 230,
    right: -80,
    top: -100,
    borderWidth: 1,
    borderRadius: 115,
    borderColor: colors.gold,
  },
  innerRing: {
    position: 'absolute',
    width: 170,
    height: 170,
    right: -50,
    top: -70,
    borderWidth: 1,
    borderRadius: 85,
    borderColor: colors.gold,
  },
  icon: {
    width: 52,
    height: 52,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.greenWash,
  },
  monogram: {
    color: colors.hunter,
    fontSize: 28,
    fontWeight: '800',
    includeFontPadding: false,
  },
  title: { color: colors.white, fontFamily: 'serif', fontSize: 32, fontWeight: '700' },
  subtitle: { color: colors.sand, fontSize: 15, lineHeight: 22 },
  form: {
    padding: 20,
    borderRadius: 18,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 16,
  },
  formTitle: { fontSize: 21, lineHeight: 28, color: colors.forest, fontWeight: '700' },
  field: { gap: 6 },
  fieldLabel: { fontSize: 15, lineHeight: 21, color: colors.ink, fontWeight: '600' },
  help: { fontSize: 15, lineHeight: 22, color: colors.muted },
  input: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 2,
    borderColor: colors.fieldBorder,
    borderRadius: 10,
    backgroundColor: colors.white,
    color: colors.forest,
    fontSize: 16,
    textAlign: 'left',
    textAlignVertical: 'center',
  },
  focusedInput: { borderColor: colors.hunter, backgroundColor: colors.white },
});
