// truncate a string to a max length by replacing the middle with an
// ellipsis. preserves the first and last characters so identifiers
// remain visually distinguishable (e.g. node ids, user ids).
//
//   truncateMiddle("abcdefghijklmno", 10) => "abcd...lmno"
//
// returns the original string unchanged if it already fits.

export function truncateMiddle(value: string, maxLength = 16, ellipsis = "..."): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= ellipsis.length) return ellipsis.slice(0, maxLength);
  const charsToShow = maxLength - ellipsis.length;
  const front = Math.ceil(charsToShow / 2);
  const back = Math.floor(charsToShow / 2);
  return `${value.slice(0, front)}${ellipsis}${value.slice(value.length - back)}`;
}
