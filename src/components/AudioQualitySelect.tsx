import type { AudioQuality } from "../types";
import { AUDIO_QUALITY_OPTIONS } from "../lib/audio";
import { AudioSelect } from "./AudioSelect";

const OPTIONS = AUDIO_QUALITY_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
  hint: option.hint,
}));

interface AudioQualitySelectProps {
  value: AudioQuality;
  disabled: boolean;
  onChange: (value: AudioQuality) => void;
}

export function AudioQualitySelect({ value, disabled, onChange }: AudioQualitySelectProps) {
  return (
    <AudioSelect
      value={value}
      options={OPTIONS}
      label="Sound quality"
      disabled={disabled}
      onChange={(next) => onChange(next as AudioQuality)}
    />
  );
}
