// In-game menu captions.

export interface GuiTexts {
  /** idx 0: window title; "/2" sets the letter spacing */
  title: string;
  newGame: string;
  load: string;
  save: string;
  gameCtrl: string;
  audioCtrl: string;
  about: string;
  quit: string;
  resume: string;
  gameOptionsTitle: string;
  walkSpeed: string;
  talkInterruption: string;
  showText: string;
  showBullet: string;
  yes: string;
  no: string;
  mainMenu: string;
  audioOptionsTitle: string;
  musicVolume: string;
  sfxVolume: string;
  talkVolume: string;
  reverseStereo: string;
  surround: string;
  musicDown: string;
  /** idx 31; `|` breaks the line */
  confirmQuit: string;
  confirmYes: string;
  confirmNo: string;
  ok: string;
}

/** Language 'P'. */
export const TEXTS_PL: GuiTexts = {
  title: "/2- Jack Orlando -",
  newGame: "Rozpocznij nową grę",
  load: "Załaduj grę",
  save: "Zapisz aktualną grę",
  gameCtrl: "Opcje gry",
  audioCtrl: "Opcje audio",
  about: "O grze",
  quit: "Zakończ grę",
  resume: "Wróć do gry",
  gameOptionsTitle: "Opcje gry",
  walkSpeed: "Szybkość chodu",
  talkInterruption: "Przerywanie mowy",
  showText: "Pokazać teksty",
  showBullet: "Pokazać nabój",
  yes: "Tak",
  no: "Nie",
  mainMenu: "Menu główne",
  audioOptionsTitle: "Opcje Audio",
  musicVolume: "Głośność muzyki",
  sfxVolume: "Głośność efektów",
  talkVolume: "Głośność mowy",
  reverseStereo: "Zamienić kanały stereo",
  surround: "Pseudo surround muzyki",
  musicDown: "Ściszać muzykę podczas dialogów",
  confirmQuit: "Czy na pewno chcesz zakończyć grę=?",
  confirmYes: " Tak ",
  confirmNo: " Nie ",
  ok: "Ok",
};

/** English captions. Yes and No stay the Polish words. */
export const TEXTS_EN: GuiTexts = {
  ...TEXTS_PL,
  newGame: "Start a new game",
  load: "Load a game",
  save: "Save the game",
  gameCtrl: "Game controls",
  audioCtrl: "Audio controls",
  about: "About game",
  quit: "Quit playing",
  resume: "Resume game",
  gameOptionsTitle: "Game controls",
  walkSpeed: "Walk speed",
  talkInterruption: "Talk interruption",
  showText: "Dialogue subtitles",
  showBullet: "Show bullet",
  mainMenu: "Main menu",
  audioOptionsTitle: "Audio controls",
  musicVolume: "Music volume",
  sfxVolume: "SFX volume",
  talkVolume: "Talking volume",
  reverseStereo: "Reverse stereo",
  surround: "Pseudo surround music",
  musicDown: "Decrease music volume during dialogue",
  confirmQuit: "Are you sure you want to quit playing=?",
};
