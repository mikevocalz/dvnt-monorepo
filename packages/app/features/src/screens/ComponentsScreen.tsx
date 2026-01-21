import { View, Text, StyleSheet } from 'react-native';
import { Button, Card, TextField } from 'ui';
import { ScreenWrapper, Section } from './shared';

export function ComponentsScreen() {
  return (
    <ScreenWrapper
      title="Components"
      subtitle="Preview shared UI building blocks from the ui package."
    >
      <Section title="Buttons" description="Primary and secondary actions that work everywhere.">
        <View style={styles.buttonRow}>
          <Button color="primary" onPress={() => {}}>
            Primary
          </Button>
          <Button variant="flat" onPress={() => {}}>
            Secondary
          </Button>
          <Button variant="bordered" onPress={() => {}}>
            Outline
          </Button>
        </View>
      </Section>

      <Section title="Cards" description="Use cards to group related content across platforms.">
        <View style={styles.cardStack}>
          <Card>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>Cross-platform layout</Text>
              <Text style={styles.cardText}>
                Build feature sections once and reuse them in web and native apps.
              </Text>
            </View>
          </Card>
          <Card>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>Consistent theming</Text>
              <Text style={styles.cardText}>
                The ui package keeps colors, spacing, and typography aligned.
              </Text>
            </View>
          </Card>
        </View>
      </Section>

      <Section title="Inputs" description="Forms can stay consistent on every screen.">
        <View style={styles.fieldStack}>
          <TextField label="Project name" placeholder="Launch plan" />
          <TextField label="Owner" placeholder="Design Systems" />
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
  fieldStack: {
    gap: 12,
  },
});
