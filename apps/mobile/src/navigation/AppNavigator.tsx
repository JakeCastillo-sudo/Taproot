import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../store/auth.store';
import LoginScreen from '../screens/auth/LoginScreen';
import PinLoginScreen from '../screens/auth/PinLoginScreen';
import POSScreen from '../screens/pos/POSScreen';
import KitchenScreen from '../screens/kitchen/KitchenScreen';
import OrdersScreen from '../screens/orders/OrdersScreen';
import { colors } from '../utils/colors';

const Tab = createBottomTabNavigator();

/**
 * We deliberately avoid @react-navigation/stack (its peer dep
 * @react-native-masked-view/masked-view is not installed). The auth gate is a
 * plain conditional render; the authed shell uses bottom tabs.
 */
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.gray,
        tabBarIcon: ({ color, size }) => {
          const icon =
            route.name === 'POS' ? 'pricetags' : route.name === 'Kitchen' ? 'restaurant' : 'receipt';
          return <Ionicons name={icon} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="POS" component={POSScreen} />
      <Tab.Screen name="Orders" component={OrdersScreen} />
      <Tab.Screen name="Kitchen" component={KitchenScreen} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const status = useAuthStore((s) => s.status);
  const switchingUser = useAuthStore((s) => s.switchingUser);
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (status === 'loading') {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (status === 'guest') {
    return <LoginScreen />;
  }

  // Authed. PIN switch-user takes over the screen when requested.
  if (switchingUser) {
    return <PinLoginScreen />;
  }

  return (
    <NavigationContainer>
      <MainTabs />
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
});
