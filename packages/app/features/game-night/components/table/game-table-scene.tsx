import { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import {
  Canvas,
  Circle,
  Group,
  Paragraph,
  RoundedRect,
  Skia,
  TextAlign,
  vec,
  type SkParagraph,
} from "@shopify/react-native-skia";
import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { layoutSeats, orderReveal } from "./table-logic";
import type { GameTableProps } from "./types";

const TABLE_MAX_WIDTH = 920;
const TABLE_HEIGHT = 620;
const CARD_W = 126;
const CARD_H = 164;

function useParagraph(text: string, size: number, color = "#f7f4ff") {
  const paragraph = useMemo(() => {
    const builder = Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Center });
    builder.pushStyle({ fontSize: size, color: Skia.Color(color) });
    builder.addText(text);
    return builder.build();
  }, [text, size, color]);
  useEffect(() => () => paragraph.dispose(), [paragraph]);
  return paragraph;
}

function Label({ text, x, y, width, size = 14, color }: {
  text: string; x: number; y: number; width: number; size?: number; color?: string;
}) {
  const paragraph = useParagraph(text, size, color);
  useMemo(() => paragraph.layout(width), [paragraph, width]);
  return <Paragraph paragraph={paragraph} x={x} y={y} width={width} />;
}

function Card({ x, y, text, selected = false, concealed = false, winner = false, opacity = 1 }: {
  x: number; y: number; text: string; selected?: boolean; concealed?: boolean;
  winner?: boolean; opacity?: number | { value: number };
}) {
  return (
    <Group opacity={opacity as number}>
      {winner ? <RoundedRect x={x - 7} y={y - 7} width={CARD_W + 14} height={CARD_H + 14} r={18} color="#f4c95d55" /> : null}
      <RoundedRect x={x} y={y} width={CARD_W} height={CARD_H} r={13} color={concealed ? "#4a276e" : selected ? "#d9c6ff" : "#f5f0ff"} />
      <RoundedRect x={x + 5} y={y + 5} width={CARD_W - 10} height={CARD_H - 10} r={9} color={concealed ? "#21122f" : "#241932"} />
      <Label text={concealed ? "DVNT\nGAME NIGHT" : text} x={x + 11} y={y + 24} width={CARD_W - 22} size={concealed ? 13 : 15} />
    </Group>
  );
}

export function GameTableScene(props: GameTableProps) {
  const window = useWindowDimensions();
  const width = Math.min(TABLE_MAX_WIDTH, Math.max(340, window.width - 24));
  const height = Math.min(TABLE_HEIGHT, Math.max(500, window.height * 0.72));
  const seats = layoutSeats(props.members, width, height - 110);
  const reveals = orderReveal(props.reveal);
  const displayCards = props.state === "duel" ? props.duelOptions ?? [] : props.myHand;
  const revealProgress = useSharedValue(0);
  const dealProgress = useSharedValue(0);
  const winnerPulse = useSharedValue(0.35);

  useEffect(() => {
    dealProgress.value = 0;
    dealProgress.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });
    return () => cancelAnimation(dealProgress);
  }, [displayCards.length, dealProgress]);

  useEffect(() => {
    revealProgress.value = 0;
    revealProgress.value = withTiming(reveals.length ? 1 : 0, { duration: 520 });
    winnerPulse.value = withRepeat(withTiming(0.9, { duration: 700 }), -1, true);
    return () => {
      cancelAnimation(revealProgress);
      cancelAnimation(winnerPulse);
    };
  }, [reveals.length, revealProgress, winnerPulse]);

  const handOpacity = useDerivedValue(() => dealProgress.value);
  const shownOpacity = useDerivedValue(() => revealProgress.value);
  const winnerOpacity = useDerivedValue(() => winnerPulse.value);
  const handY = height - CARD_H - 12;
  const gap = Math.min(CARD_W + 12, (width - 24) / Math.max(displayCards.length, 1));
  const handStart = (width - gap * displayCards.length) / 2;

  return (
    <View style={[styles.frame, { width, height }]}>
      <Canvas style={StyleSheet.absoluteFill}>
        <RoundedRect x={0} y={0} width={width} height={height} r={34} color="#120b1b" />
        <RoundedRect x={12} y={12} width={width - 24} height={height - 24} r={27} color="#253c37" />
        <RoundedRect x={24} y={24} width={width - 48} height={height - 48} r={23} color="#172e2a" />
        <RoundedRect x={width / 2 - 150} y={28} width={300} height={112} r={14} color="#6b2ea1" />
        <Label text={`PICK ${props.prompt.pick}\n${props.prompt.text}`} x={width / 2 - 138} y={45} width={276} size={17} />
        {seats.map((seat) => (
          <Group key={seat.user_id}>
            <Circle cx={seat.x} cy={seat.y} r={seat.user_id === props.judgeUserId ? 29 : 25} color={seat.user_id === props.judgeUserId ? "#f4c95d" : "#8f63c6"} />
            <Label text={seat.avatar || seat.name.slice(0, 1).toUpperCase()} x={seat.x - 22} y={seat.y - 13} width={44} size={18} />
            <Label text={seat.name} x={seat.x - 55} y={seat.y + 31} width={110} size={12} />
          </Group>
        ))}
        {!reveals.length && props.state !== "lobby" ? Array.from({ length: props.submissionsIn }).map((_, i) => (
          <Card key={`down-${i}`} x={width / 2 - CARD_W / 2 + (i - (props.submissionsIn - 1) / 2) * 34} y={175 + Math.abs(i - 2) * 4} text="" concealed />
        )) : null}
        {reveals.slice(0, 5).map((entry, i) => (
          <Card key={entry.submission_id} x={width / 2 - (Math.min(reveals.length, 5) * 142) / 2 + i * 142 + 8} y={165} text={entry.texts.join("\n")} winner={entry.is_winner} opacity={entry.is_winner ? winnerOpacity : shownOpacity} />
        ))}
        <Label text={`${props.submissionsIn}/${props.submissionsExpected} submitted`} x={width / 2 - 90} y={145} width={180} size={12} color="#b7cabf" />
        {displayCards.map((card, i) => (
          <Card key={card.card_id} x={handStart + i * gap} y={handY} text={card.text} selected={props.selected.includes(card.card_id)} opacity={handOpacity} />
        ))}
      </Canvas>
      {displayCards.map((card, i) => (
        <Pressable key={card.card_id} accessibilityRole="button" accessibilityLabel={card.text} onPress={() => props.state === "duel" ? props.onDuelPick?.(card.card_id) : props.onSelectCard(card.card_id)} style={[styles.hit, { left: handStart + i * gap, top: handY, width: CARD_W, height: CARD_H }]} />
      ))}
      {props.state === "judging" ? reveals.slice(0, 5).map((entry, i) => (
        <Pressable key={entry.submission_id} accessibilityRole="button" accessibilityLabel={`Pick submission ${i + 1}`} onPress={() => props.onPickWinner(entry.submission_id)} style={[styles.hit, { left: width / 2 - (Math.min(reveals.length, 5) * 142) / 2 + i * 142 + 8, top: 165, width: CARD_W, height: CARD_H }]} />
      )) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignSelf: "center", overflow: "hidden" },
  hit: { position: "absolute" },
});
