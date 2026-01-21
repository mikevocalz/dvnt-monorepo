import { View, Text, StyleSheet } from 'react-native';
import { Button, Chip } from 'ui';
import { ScreenWrapper, Section } from './shared';

const highlights = ['Shared UI', 'Unified navigation', 'Faster shipping', 'Single source of truth'];

export function HomeScreen() {
  return (
    <ScreenWrapper
      title="Welcome home"
      subtitle="All screens now live in packages/app/features so web and mobile stay in sync."
    >
      <Section
        title="Get started"
        description="Reuse these screens in both Expo Router and Next.js."
      >
        <View style={styles.buttonRow}>
          <Button color="primary" onPress={() => {}}>
            Build feature
          </Button>
          <Button variant="flat" onPress={() => {}}>
            View roadmap
          </Button>
        </View>
      </Section>

      <Section
        title="Highlights"
        description="A few quick wins from consolidating the app surface."
      >
        <View style={styles.chipRow}>
          {highlights.map((item) => (
            <Chip key={item} variant="flat">
              {item}
            </Chip>
          ))}
        </View>
      </Section>

      <Section
        title="Next steps"
        description="Add new screens here and import them from the app routers."
      >
        <View style={styles.list}>
          <Text style={styles.listItem}>• Create a new folder under packages/app/features.</Text>
          <Text style={styles.listItem}>• Export the screen from the features index.</Text>
          <Text style={styles.listItem}>• Reference it in your mobile and web routes.</Text>
        </View>
      </Section>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  list: {
    gap: 8,
  },
  listItem: {
    fontSize: 14,
    color: '#374151',
  },
});
