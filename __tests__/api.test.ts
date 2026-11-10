import { ApiError, authorFromUrl, describeApiError, parseInstagramUrl } from '../services/api';

describe('parseInstagramUrl', () => {
  it.each([
    ['https://www.instagram.com/reel/DU1KGbmElgC/', 'DU1KGbmElgC'],
    ['https://www.instagram.com/reel/DU1KGbmElgC', 'DU1KGbmElgC'],
    ['https://instagram.com/reels/DZK3iOsRlWX/?igsh=abc', 'DZK3iOsRlWX'],
    ['https://www.instagram.com/p/DOq6eV6iIgD/', 'DOq6eV6iIgD'],
    ['https://www.instagram.com/utkarsh712/reel/DS5SxvLgbc8/', 'DS5SxvLgbc8'],
    ['https://www.instagram.com/share/reel/DU1KGbmElgC/', 'DU1KGbmElgC'],
    ['https://www.instagram.com/tv/DU1KGbmElgC/', 'DU1KGbmElgC'],
  ])('extracts the shortcode from %s', (url, shortcode) => {
    expect(parseInstagramUrl(url)?.shortcode).toBe(shortcode);
  });

  it('always canonicalises to a /reel/ URL', () => {
    expect(parseInstagramUrl('https://www.instagram.com/utkarsh712/reel/DS5SxvLgbc8/'))
      .toMatchObject({ canonicalUrl: 'https://www.instagram.com/reel/DS5SxvLgbc8/' });
  });

  it('flags photo posts', () => {
    expect(parseInstagramUrl('https://www.instagram.com/p/DOq6eV6iIgD/')?.isPost).toBe(true);
    expect(parseInstagramUrl('https://www.instagram.com/reel/DU1KGbmElgC/')?.isPost).toBe(false);
  });

  it.each([
    // Feed and non-post Instagram pages must never be treated as reels.
    ['https://www.instagram.com/reels/', 'the reels feed'],
    ['https://www.instagram.com/reels/audio/123456789/', 'an audio page'],
    ['https://www.instagram.com/explore/tags/reels/', 'an explore page'],
    ['https://www.instagram.com/utkarsh712/', 'a profile'],
    ['https://www.instagram.com/stories/utkarsh712/123456/', 'a story'],
    ['https://example.com/reel/DU1KGbmElgC/', 'a non-Instagram host'],
    ['https://instagr.am/reel/DU1KGbmElgC/', 'the instagr.am short host'],
    ['not a url', 'garbage'],
    ['', 'an empty string'],
  ])('rejects %s (%s)', url => {
    expect(parseInstagramUrl(url)).toBeNull();
  });
});

describe('authorFromUrl', () => {
  it('reads the handle from a profile-prefixed link', () => {
    expect(authorFromUrl('https://www.instagram.com/utkarsh712/reel/DS5SxvLgbc8/')).toBe('utkarsh712');
  });

  it('returns null when the link has no handle', () => {
    expect(authorFromUrl('https://www.instagram.com/reel/DS5SxvLgbc8/')).toBeNull();
    expect(authorFromUrl('nonsense')).toBeNull();
  });
});

describe('describeApiError', () => {
  it('turns an API code into a user-facing sentence', () => {
    expect(describeApiError(new ApiError('NOT_FOUND', 'x'))).toMatch(/private, deleted/);
    expect(describeApiError(new ApiError('NETWORK', 'x'))).toMatch(/No internet/);
    expect(describeApiError(new ApiError('RATE_LIMITED', 'x'))).toMatch(/Too many requests/);
  });

  it('falls back for unknown errors', () => {
    expect(describeApiError(new Error('boom'))).toMatch(/Something went wrong/);
    expect(describeApiError(undefined)).toMatch(/Something went wrong/);
  });

  it('treats retryable flags as data, not prose', () => {
    expect(new ApiError('SERVER', 'x', { retryable: true }).retryable).toBe(true);
    expect(new ApiError('NOT_FOUND', 'x').retryable).toBe(false);
  });
});
