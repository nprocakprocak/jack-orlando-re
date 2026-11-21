// Jack's three refusal captions, voice names, and caption widths.
// The widths are the ones used for the Polish captions.

export interface BundledRefusal {
  text: string;
  voice: string;
  width: number;
}

export const JACK_REFUSALS: BundledRefusal[] = [
  { text: "Nie mogę tego tu zostawić.", voice: "N010.SND", width: 245 },
  { text: "To jeszcze może się przydać.", voice: "N020.SND", width: 265 },
  { text: "Bardzo głupi pomysł.", voice: "N030.SND", width: 185 },
];
