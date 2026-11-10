import { extractHashtags } from '../utils/format';

describe('extractHashtags', () => {
  it('returns tags without the hash, in caption order', () => {
    expect(extractHashtags('sunset vibes #travel #sunset')).toEqual(['travel', 'sunset']);
  });

  it('splits tags that touch each other', () => {
    expect(extractHashtags('#a #b#c')).toEqual(['a', 'b', 'c']);
  });

  it('handles empty and missing captions', () => {
    expect(extractHashtags('')).toEqual([]);
    expect(extractHashtags(undefined)).toEqual([]);
    expect(extractHashtags('no tags here')).toEqual([]);
  });

  it('does not repeat a tag', () => {
    expect(extractHashtags('#reels #reels #REELS')).toEqual(['reels', 'REELS']);
  });
});
