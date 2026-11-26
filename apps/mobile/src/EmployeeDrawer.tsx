import { useRef } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from './theme';

const links = [
  ['Attendance', 'Home'],
  ['Visits', 'Field visits'],
  ['History', 'Attendance history'],
  ['OfflineQueue', 'Visit sync queue'],
  ['Profile', 'Profile and settings'],
  ['Permissions', 'App permissions'],
] as const;
export type DrawerRoute = (typeof links)[number][0];
type EmployeeLabel = { fullName: string; employeeCode: string };

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => Array.from(part)[0])
      .join('')
      .toUpperCase() || 'E'
  );
}
export function ToolbarButton({
  label,
  onPress,
  employee,
}: {
  label: string;
  onPress: () => void;
  employee?: EmployeeLabel;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={layout.toolbar}
    >
      {employee ? (
        <Text maxFontSizeMultiplier={1.25} style={layout.avatar}>
          {initials(employee.fullName)}
        </Text>
      ) : (
        <View style={layout.menuGlyph}>
          {[0, 1, 2].map((line) => (
            <View key={line} style={layout.menuLine} />
          ))}
        </View>
      )}
    </Pressable>
  );
}

export function EmployeeDrawer({
  employee,
  visible,
  current,
  close,
  open,
}: {
  employee: EmployeeLabel;
  visible: boolean;
  current: string;
  close: () => void;
  open: (route: DrawerRoute) => void;
}) {
  const panel = useRef<ScrollView>(null);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
      onShow={() => panel.current?.scrollTo({ y: 0, animated: false })}
    >
      <View style={layout.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Close navigation"
          onPress={close}
        />
        <SafeAreaView style={layout.drawer} accessibilityViewIsModal>
          <ScrollView ref={panel} contentContainerStyle={layout.content}>
            <View style={layout.heading}>
              <Text style={layout.brand}>RSS HRMS Desk</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close menu"
                onPress={close}
                style={layout.toolbar}
              >
                <Text style={layout.close}>×</Text>
              </Pressable>
            </View>
            <View style={layout.account}>
              <Text style={layout.avatar}>{initials(employee.fullName)}</Text>
              <View style={layout.accountCopy}>
                <Text style={layout.linkLabel}>{employee.fullName}</Text>
                <Text style={layout.code}>{employee.employeeCode}</Text>
              </View>
            </View>
            {links.map(([route, label]) => (
              <Pressable
                key={route}
                accessibilityRole="button"
                accessibilityState={{ selected: current === route }}
                onPress={() => open(route)}
                style={({ pressed }) => [
                  layout.link,
                  (pressed || current === route) && layout.selected,
                ]}
              >
                <Text style={layout.linkLabel}>{label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const layout = StyleSheet.create({
  toolbar: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  menuGlyph: { gap: 4 },
  menuLine: { width: 21, height: 2, borderRadius: 1, backgroundColor: colors.white },
  avatar: {
    color: colors.forest,
    backgroundColor: colors.sand,
    minWidth: 34,
    minHeight: 34,
    borderRadius: 18,
    paddingHorizontal: 6,
    textAlign: 'center',
    textAlignVertical: 'center',
    lineHeight: 34,
    fontSize: 13,
    fontWeight: '800',
    overflow: 'hidden',
  },
  overlay: { flex: 1, backgroundColor: '#102B2388', alignItems: 'flex-start' },
  drawer: { flex: 1, width: '84%', maxWidth: 340, backgroundColor: colors.forest },
  content: { gap: 8, padding: 16 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  brand: { flex: 1, fontSize: 22, fontWeight: '700', color: colors.white },
  close: { color: colors.white, fontSize: 26 },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  accountCopy: { flex: 1, gap: 4 },
  code: { color: colors.sand, fontSize: 14 },
  link: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: 10,
  },
  selected: { backgroundColor: colors.hunter },
  linkLabel: { color: colors.white, fontSize: 16, fontWeight: '600' },
});
