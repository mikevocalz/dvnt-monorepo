import type { CSSProperties, ReactNode } from 'react';

export type PasteEventPayload =
  | { type: 'text'; value: string }
  | { type: 'images'; uris: string[] }
  | { type: 'unsupported' };

export interface PasteInputProps {
  children?: ReactNode;
  className?: string;
  onPaste?: (payload: PasteEventPayload) => void;
  style?: CSSProperties;
  testID?: string;
}

export function PasteInput({
  children,
  className,
  onPaste,
  style,
  testID,
}: PasteInputProps) {
  return (
    <div
      className={className}
      data-testid={testID}
      onPaste={(event) => {
        if (!onPaste) return;

        const files = Array.from(event.clipboardData.files).filter((file) =>
          file.type.startsWith('image/'),
        );

        if (files.length > 0) {
          event.preventDefault();
          onPaste({
            type: 'images',
            uris: files.map((file) => URL.createObjectURL(file)),
          });
          return;
        }

        const text = event.clipboardData.getData('text/plain');
        onPaste(text ? { type: 'text', value: text } : { type: 'unsupported' });
      }}
      style={{ width: '100%', ...style }}
    >
      {children}
    </div>
  );
}
