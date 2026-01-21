import { View, Text, TextInput } from 'react-native';

interface InputProps {
  label: string;
  placeholder?: string;
  value?: string;
  onChangeText?: (text: string) => void;
}

export function Input({ label, placeholder, value, onChangeText }: InputProps) {
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-medium text-gray-700">{label}</Text>
      <TextInput
        className="px-3 py-2.5 border border-gray-300 rounded-md text-gray-900 text-base"
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        value={value}
        onChangeText={onChangeText}
      />
    </View>
  );
}
