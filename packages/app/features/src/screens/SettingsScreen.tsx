import { View, Text, StyleSheet } from 'react-native';
import { Card, Checkbox, Switch } from 'ui';
import { ScreenWrapper, Section } from './shared';

export function SettingsScreen() {
  return (
    <ScreenWrapper
      title="Settings"
      subtitle="Preference toggles that stay aligned everywhere."
    >
      <Section title="Preferences" description="Update defaults for every platform at once.">
        <View style={styles.preferenceStack}>
          <Card>
            <View style={styles.preferenceRow}>
              <View style={styles.preferenceText}>
                <Text style={styles.preferenceTitle}>Product updates</Text>
                <Text style={styles.preferenceSubtitle}>Get notified when shared screens change.</Text>
              </View>
              <Switch defaultSelected />
            </View>
          </Card>
          <Card>
            <View style={styles.preferenceRow}>
              <View style={styles.preferenceText}>
                <Text style={styles.preferenceTitle}>Marketing emails</Text>
                <Text style={styles.preferenceSubtitle}>Quarterly release notes and tips.</Text>
              </View>
              <Switch />
            </View>
          </Card>
        </View>
      </Section>

      <Section title="Access" description="Control who can edit shared routes.">
        <View style={styles.checkboxStack}>
          <Checkbox defaultSelected>Admin access</Checkbox>
          <Checkbox>Content editors</Checkbox>
          <Checkbox>Read-only guests</Checkbox>
        </View>
      </Section>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  preferenceStack: {
    gap: 12,
  },
  preferenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  preferenceText: {
    flex: 1,
    paddingRight: 16,
  },
  preferenceTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  preferenceSubtitle: {
    marginTop: 6,
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
  },
  checkboxStack: {
    gap: 12,
  },
});
