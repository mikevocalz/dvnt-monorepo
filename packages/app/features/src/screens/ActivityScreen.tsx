import { View, Text, StyleSheet } from 'react-native';
import { Card, Chip } from 'ui';
import { ScreenWrapper, Section } from './shared';

const updates = [
  { title: 'Design refresh', description: 'New tokens are ready for both web and mobile.' },
  { title: 'Shared analytics', description: 'Instrumentation lives alongside the screens.' },
  { title: 'Navigation polish', description: 'Tabs now map to the same screen components.' },
];

export function ActivityScreen() {
  return (
    <ScreenWrapper
      title="Activity"
      subtitle="Track what changed across the shared experience."
    >
      <Section title="Recent updates" description="Everything shipped from the features package.">
        <View style={styles.cardStack}>
          {updates.map((update) => (
            <Card key={update.title}>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{update.title}</Text>
                <Text style={styles.cardText}>{update.description}</Text>
                <View style={styles.cardMeta}>
                  <Chip size="sm" variant="flat">
                    Shared
                  </Chip>
                  <Chip size="sm" variant="flat">
                    Today
                  </Chip>
                </View>
              </View>
            </Card>
          ))}
        </View>
      </Section>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
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
  cardMeta: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
  },
});
