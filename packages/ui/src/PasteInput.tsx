import type { ComponentProps, ComponentType, ReactNode } from 'react';
import { TextInputWrapper } from 'expo-paste-input';
import { styled } from 'nativewind';

export type PasteEventPayload = NonNullable<
  ComponentProps<typeof TextInputWrapper>['onPaste']
> extends (payload: infer Payload) => void
  ? Payload
  : never;

export interface PasteInputProps {
  children?: ReactNode;
  className?: string;
  onPaste?: (payload: PasteEventPayload) => void;
}

// Double cast breaks the TS2590 union explosion from the styled HOC —
// the explicit PasteInputProps interface keeps the public API typed.
// @ts-ignore — TS2590: TextInputWrapper's prop union is too complex for tsc
const NativeWindTextInputWrapper = styled(TextInputWrapper, {
  className: { target: 'style' },
}) as unknown as ComponentType<PasteInputProps>;

export function PasteInput(props: PasteInputProps) {
  return <NativeWindTextInputWrapper {...props} />;
}
