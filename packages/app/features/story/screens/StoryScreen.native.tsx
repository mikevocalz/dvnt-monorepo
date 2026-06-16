import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

const HERO_POSTER_SRC =
  'https://images.squarespace-cdn.com/content/v1/6970176c1abbac076dce861e/c8070a27-5b5e-42f3-bb47-c8502dec8b1a/DVNT_social.png?format=1500w';

const chapters = [
  {
    kicker: 'DVNT.APP',
    title: 'connect. gather. move.',
    copy: 'An intentional space for queer people to connect, gather, and move culture on their own terms.',
  },
  {
    kicker: 'What is DVNT?',
    title: 'Nightlife, community, and curated access.',
    copy: 'A members-first app built around rooms, recaps, events, private conversations, and profile signals.',
  },
  {
    kicker: 'Access looks good on you.',
    title: 'Your profile is a signal.',
    copy: 'Set your vibe, control what is visible, and let the right people find you.',
  },
];

export function StoryScreen() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Image source={{ uri: HERO_POSTER_SRC }} style={styles.heroImage} />
        <View style={styles.scrim} />
        <View style={styles.heroCopy}>
          <Text style={styles.kicker}>DVNT.APP</Text>
          <Text style={styles.title}>connect. gather. move.</Text>
        </View>
      </View>

      {chapters.map((chapter) => (
        <View key={chapter.kicker} style={styles.chapter}>
          <Text style={styles.kicker}>{chapter.kicker}</Text>
          <Text style={styles.chapterTitle}>{chapter.title}</Text>
          <Text style={styles.copy}>{chapter.copy}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#02030A',
  },
  content: {
    paddingBottom: 48,
  },
  hero: {
    minHeight: 560,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    backgroundColor: '#02030A',
  },
  heroImage: {
    position: 'absolute',
    inset: 0,
    opacity: 0.86,
  },
  scrim: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(2, 3, 10, 0.45)',
  },
  heroCopy: {
    padding: 24,
    paddingBottom: 48,
  },
  kicker: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  title: {
    marginTop: 16,
    color: '#FFFFFF',
    fontSize: 56,
    lineHeight: 56,
    fontWeight: '900',
  },
  chapter: {
    marginHorizontal: 20,
    marginTop: 20,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  chapterTitle: {
    marginTop: 12,
    color: '#FFFFFF',
    fontSize: 28,
    lineHeight: 31,
    fontWeight: '900',
  },
  copy: {
    marginTop: 12,
    color: 'rgba(255,255,255,0.68)',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
  },
});
