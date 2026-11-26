import 'react-native-get-random-values';
import { VisitCamera, VisitDetail, VisitDraft, VisitHistory } from './src/visits';
import { colors, homeColors } from './src/theme';
import { useEffect, useRef, useState } from 'react';
import { StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MobileProfile, UpdateNotice, useReleasePolicy } from './src/release';
import { OfflineQueue, useForegroundVisitSync } from './src/OfflineQueue';
import { SignInLayout, signInStyles } from './src/SignInLayout';
import { EmployeeDrawer, ToolbarButton, type DrawerRoute } from './src/EmployeeDrawer';
import { PermissionSettings } from './src/PermissionSettings';
import { RenukaLogo } from './src/RenukaLogo';
import {
  cachedEmployee,
  isTransientMobileError,
  loginEmployee,
  logoutEmployee,
  onSessionInvalid,
  restoreMobileSession,
} from './src/api';
import {
  Action,
  AttendanceDetails,
  AttendanceHistory,
  AttendanceHome,
  Problem,
  ShiftScreen,
  type AttendanceStack,
} from './src/attendanceScreens';

const Stack = createNativeStackNavigator<AttendanceStack>();
const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => count < 1 && isTransientMobileError(error),
      retryDelay: (_, error) =>
        isTransientMobileError(error) ? (error.retryAfterMs ?? 1500) : 1500,
    },
  },
});
type Employee = Awaited<ReturnType<typeof loginEmployee>>;

function LaunchScreen() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: homeColors.red,
      }}
    >
      <StatusBar barStyle="light-content" />
      <RenukaLogo style={branding.launchLogo} />
    </View>
  );
}

function SessionApp() {
  const navigation = useNavigationContainerRef<AttendanceStack>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [onHome, setOnHome] = useState(true);
  const updateHome = () => setOnHome(navigation.getCurrentRoute()?.name === 'Attendance');
  function openDrawerRoute(route: DrawerRoute) {
    setDrawerOpen(false);
    if (navigation.isReady() && navigation.getCurrentRoute()?.name !== route)
      navigation.navigate(route);
  }
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const passwordInput = useRef<TextInput>(null);
  const [focusedField, setFocusedField] = useState<'identifier' | 'password'>();
  const [loginError, setLoginError] = useState('');
  const [entering, setEntering] = useState(false);
  const release = useReleasePolicy();
  useForegroundVisitSync(
    release.data?.updateRequired ? undefined : employee?.id,
    release.data?.offlineSyncMaxRetries,
  );
  async function restore() {
    setRestoring(true);
    setRestoreError('');
    let cached: Employee | undefined;
    try {
      cached = await cachedEmployee().catch(() => undefined);
      if (cached) {
        setEmployee(cached);
        setRestoring(false);
      }
      const restored = (await restoreMobileSession())?.user ?? null;
      setEmployee(restored);
    } catch (error) {
      if (cached && isTransientMobileError(error)) return;
      setEmployee(null);
      setRestoreError(error instanceof Error ? error.message : 'Could not restore your session.');
    } finally {
      setRestoring(false);
    }
  }
  useEffect(() => {
    const unsubscribe = onSessionInvalid(() => {
      setEmployee(null);
      client.clear();
    });
    void restore();
    return unsubscribe;
  }, []);
  async function login() {
    if (!identifier.trim() || !password || entering) return;
    setEntering(true);
    setLoginError('');
    try {
      setEmployee(await loginEmployee(identifier.trim(), password));
      setPassword('');
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Could not sign in.');
    } finally {
      setEntering(false);
    }
  }
  if (restoring) return <LaunchScreen />;
  if (release.data?.updateRequired)
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <UpdateNotice policy={release.data} required />
      </SafeAreaView>
    );
  if (!employee)
    return (
      <SignInLayout>
        {restoreError ? (
          <Problem message={restoreError} retry={() => void restore()} />
        ) : (
          <View style={signInStyles.form}>
            <Text accessibilityRole="header" style={signInStyles.formTitle}>
              Employee sign in
            </Text>
            <View style={signInStyles.field}>
              <Text style={signInStyles.fieldLabel}>Email or employee ID</Text>
              <TextInput
                accessibilityLabel="Email or employee ID"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                style={[
                  signInStyles.input,
                  focusedField === 'identifier' && signInStyles.focusedInput,
                ]}
                placeholder="Example: EMP0001"
                placeholderTextColor={colors.muted}
                onFocus={() => setFocusedField('identifier')}
                onBlur={() => setFocusedField(undefined)}
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => passwordInput.current?.focus()}
                value={identifier}
                onChangeText={setIdentifier}
              />
            </View>
            <View style={signInStyles.field}>
              <Text style={signInStyles.fieldLabel}>Password</Text>
              <TextInput
                ref={passwordInput}
                accessibilityLabel="Password"
                secureTextEntry
                autoComplete="current-password"
                maxLength={128}
                style={[
                  signInStyles.input,
                  focusedField === 'password' && signInStyles.focusedInput,
                ]}
                placeholder="Enter your password"
                placeholderTextColor={colors.muted}
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField(undefined)}
                value={password}
                onChangeText={setPassword}
                returnKeyType="go"
                onSubmitEditing={() => void login()}
              />
            </View>
            {loginError && <Problem message={loginError} />}
            <Action
              title={entering ? 'Signing in…' : 'Sign in'}
              disabled={entering || !identifier.trim() || !password}
              onPress={() => void login()}
            />
            <Text style={signInStyles.help}>
              <Text style={signInStyles.fieldLabel}>First time? </Text>
              Use the activation link from your administrator to set your password.
            </Text>
          </View>
        )}
      </SignInLayout>
    );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: onHome ? homeColors.red : colors.forest }}>
      <StatusBar barStyle="light-content" />
      <SafeAreaProvider>
        <NavigationContainer ref={navigation} onReady={updateHome} onStateChange={updateHome}>
          <Stack.Navigator
            initialRouteName="Attendance"
            screenOptions={({ route }) => ({
              contentStyle: {
                backgroundColor: colors.ivory,
              },
              headerStyle: {
                backgroundColor: route.name === 'Attendance' ? homeColors.red : colors.forest,
              },
              headerTintColor: colors.white,
              headerTitleStyle: { fontWeight: '700' },
              headerShadowVisible: false,
              ...(route.name === 'Attendance' && {
                headerLeft: () => (
                  <ToolbarButton label="Open navigation menu" onPress={() => setDrawerOpen(true)} />
                ),
              }),
              headerRight: () => (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {route.name !== 'Attendance' && (
                    <ToolbarButton
                      label="Open navigation menu"
                      onPress={() => setDrawerOpen(true)}
                    />
                  )}
                  {route.name !== 'Profile' && (
                    <ToolbarButton
                      label="Open profile"
                      employee={employee}
                      onPress={() => openDrawerRoute('Profile')}
                    />
                  )}
                </View>
              ),
            })}
          >
            <Stack.Screen
              name="Attendance"
              options={{
                title: 'RSS HRMS Desk',
                headerTitle: () => (
                  <View style={branding.header}>
                    <RenukaLogo decorative style={branding.headerLogo} />
                    <Text accessibilityRole="header" numberOfLines={1} style={branding.headerTitle}>
                      RSS HRMS Desk
                    </Text>
                  </View>
                ),
              }}
            >
              {(props) => (
                <AttendanceHome
                  {...props}
                  employee={employee}
                  onLogout={logoutEmployee}
                  updateNotice={
                    release.data?.updateAvailable && <UpdateNotice policy={release.data} />
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="CheckIn" component={ShiftScreen} options={{ title: 'Check in' }} />
            <Stack.Screen
              name="CheckOut"
              component={ShiftScreen}
              options={{ title: 'Check out' }}
            />
            <Stack.Screen
              name="History"
              component={AttendanceHistory}
              options={{ title: 'Attendance history' }}
            />
            <Stack.Screen
              name="Details"
              component={AttendanceDetails}
              options={{ title: 'Attendance details' }}
            />
            <Stack.Screen name="Profile" options={{ title: 'Profile and settings' }}>
              {({ navigation }) => (
                <MobileProfile
                  employee={employee}
                  onLogout={logoutEmployee}
                  onPermissions={() => navigation.navigate('Permissions')}
                />
              )}
            </Stack.Screen>
            <Stack.Screen
              name="Permissions"
              component={PermissionSettings}
              options={{ title: 'App permissions' }}
            />
            <Stack.Screen name="OfflineQueue" options={{ title: 'Offline visits' }}>
              {({ navigation }) => (
                <OfflineQueue
                  enableCapture={release.data?.offlineEvidenceEnabled !== false}
                  owner={employee.id}
                  detail={(id) => navigation.replace('VisitDetail', { id })}
                />
              )}
            </Stack.Screen>
            <Stack.Screen
              name="Visits"
              component={VisitHistory}
              options={{ title: 'Field visits' }}
            />
            <Stack.Screen
              name="VisitDraft"
              component={VisitDraft}
              options={{ title: 'Visit draft' }}
            />
            <Stack.Screen
              name="VisitCamera"
              component={VisitCamera}
              options={{ title: 'Visit photo' }}
            />
            <Stack.Screen
              name="VisitDetail"
              component={VisitDetail}
              options={{ title: 'Visit details' }}
            />
          </Stack.Navigator>
        </NavigationContainer>
        <EmployeeDrawer
          employee={employee}
          visible={drawerOpen}
          current={drawerOpen ? (navigation.getCurrentRoute()?.name ?? 'Attendance') : 'Attendance'}
          close={() => setDrawerOpen(false)}
          open={openDrawerRoute}
        />
      </SafeAreaProvider>
    </SafeAreaView>
  );
}

const branding = StyleSheet.create({
  launchLogo: { width: 200, height: 152 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  headerLogo: { width: 42, height: 32, borderRadius: 6 },
  headerTitle: { flexShrink: 1, color: colors.white, fontSize: 17, fontWeight: '800' },
});
export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <QueryClientProvider client={client}>
        <SessionApp />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
