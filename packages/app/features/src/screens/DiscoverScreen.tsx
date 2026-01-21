import { View, Text, StyleSheet } from 'react-native';
import { Card, Chip } from 'ui';
import { ScreenWrapper, Section } from './shared';

const topics = ['Navigation', 'Design Tokens', 'App State', 'Notifications', 'Authentication'];

export function DiscoverScreen() {
  return (
    <ScreenWrapper
      title="Discover"
      subtitle="Keep the product roadmap aligned across platforms."
    >
      <Section title="Trending topics" description="Shared screens help you ship faster.">
        <View style={styles.chipRow}>
          {topics.map((topic) => (
            <Chip key={topic} variant="flat">
              {topic}
            </Chip>
          ))}
        </View>
      </Section>

      <Section title="Spotlight" description="Pick a slice to iterate on next.">
        <View style={styles.cardStack}>
          <Card>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>Unified onboarding</Text>
              <Text style={styles.cardText}>
                Bring web and mobile onboarding into a single feature flow.
              </Text>
            </View>
          </Card>
          <Card>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>Accessibility pass</Text>
              <Text style={styles.cardText}>
                Review shared components once and raise the baseline everywhere.
              </Text>
            </View>
          </Card>
        </View>
      </Section>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cardStack: {
    gap: 12,
  },
  cardBody: {
    padding: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  cardText: {
    marginTop: 6,
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 20,
  },
});
