/** Canonical registered-player name. Call after IME composition, never mid-composition. */
export function normalizeMemberName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\s\u200B\uFEFF]+/gu, '')
    .replace(/[ぁ-ゖゝゞ]/gu, character => String.fromCharCode(character.charCodeAt(0) + 0x60))
    .normalize('NFC');
}

/** An empty result means valid. Normalization is deliberately not a reading guess for kanji. */
export function memberNameError(value: string): string {
  const name = normalizeMemberName(value);
  if (!name) return '選手名を入力してください。';
  if (name.length > 60) return '選手名は60文字以内で入力してください。';
  if (!/^[ァ-ヺーヽヾ]+$/u.test(name) || !/[ァ-ヺ]/u.test(name)) {
    return '選手名の読みをカタカナで入力してください。漢字・英数字・記号は使えません。';
  }
  return '';
}
