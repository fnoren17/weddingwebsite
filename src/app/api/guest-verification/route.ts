import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import pool from '@/lib/db';

// Matches the `unaccent()` normalization applied in SQL below, so a name that
// matched in the database (e.g. "Noren" against a stored "Norén") also reads as
// the same person in the JS comparisons that follow (isPrimary, matched member…).
function foldAccents(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizeName(value: string): string {
  return foldAccents(value.trim().toLowerCase());
}

export async function POST(request: Request) {
  const t = await getTranslations('RSVPForm');
  try {
    const { guest_name } = await request.json();

    if (typeof guest_name !== 'string' || !guest_name.trim()) {
      return NextResponse.json(
        { verified: false, message: t('errorNameRequired') },
        { status: 400 }
      );
    }

    const typedName = guest_name.trim();
    const normalized = normalizeName(typedName);

    // Anyone in the party can look the RSVP up by their own name — the primary guest,
    // a plus-one, or any named party member. A plus-one shouldn't have to know whose
    // name the invitation was filed under.
    // Matching is accent-insensitive (`unaccent`) so "Noren" finds a guest list entry
    // stored as "Norén" — guests shouldn't have to hit the exact diacritic to be found.
    // Ordering: an exact primary-guest match wins over being listed inside someone
    // else's party, then lowest id, so the result is deterministic either way.
    const guestResult = await pool.query(
      `SELECT * FROM guest_list
        WHERE invited = true
          AND (
            unaccent(LOWER(TRIM(guest_name))) = unaccent($1)
            OR unaccent(LOWER(TRIM(COALESCE(plus_one_name, '')))) = unaccent($1)
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(party_members) = 'array' THEN party_members ELSE '[]'::jsonb END
              ) AS m
              WHERE unaccent(LOWER(TRIM(COALESCE(m->>'name', '')))) = unaccent($1)
            )
          )
        ORDER BY (unaccent(LOWER(TRIM(guest_name))) = unaccent($1)) DESC, id ASC
        LIMIT 1`,
      [normalized]
    );

    if (guestResult.rows.length > 0) {
      const guest = guestResult.rows[0];

      // Who actually logged in, using the stored spelling rather than what they typed.
      const isPrimary = normalizeName(guest.guest_name || '') === normalized;
      const members = Array.isArray(guest.party_members) ? guest.party_members : [];
      const matchedMember = members.find(
        (m: { name?: string | null }) => normalizeName(m?.name || '') === normalized
      );
      const matchedPlusOne = normalizeName(guest.plus_one_name || '') === normalized
        ? guest.plus_one_name
        : null;
      const matchedName = isPrimary
        ? guest.guest_name
        : (matchedMember?.name || matchedPlusOne || typedName);

      // The RSVP is always filed under the primary guest, so look it up by that name
      // (not the name that was typed) or a plus-one would never find the existing RSVP.
      const rsvpResult = await pool.query(
        'SELECT * FROM rsvps WHERE LOWER(guest_name) = LOWER($1) ORDER BY created_at DESC LIMIT 1',
        [(guest.guest_name || '').trim()]
      );

      let existingRsvp = null;
      if (rsvpResult.rows.length > 0) {
        const rsvp = rsvpResult.rows[0];
        existingRsvp = {
          id: rsvp.id,
          attending: rsvp.attending,
          guestCount: rsvp.number_of_guests,
          email: rsvp.email,
          phone: rsvp.phone,
          dietaryRestrictions: rsvp.dietary_restrictions,
          message: rsvp.message,
          attendingCeremony: rsvp.attending_ceremony,
          ceremonyToast: rsvp.ceremony_toast,
          welcomeDrink: rsvp.welcome_drink,
        };
      }

      return NextResponse.json({
        verified: true,
        guest: {
          name: guest.guest_name,
          party_size: guest.party_size,
          email: guest.email,
          phone: guest.phone,
          party_members: guest.party_members || [],
        },
        // Lets the form greet whoever actually signed in, so a plus-one isn't
        // confused by seeing the primary guest's name.
        matched: { name: matchedName, isPrimary },
        existingRsvp,
      });
    }

    return NextResponse.json({
      verified: false,
      message: t('errorGuestNotFound'),
    });
  } catch (error) {
    console.error('Error verifying guest:', error);
    return NextResponse.json(
      { verified: false, message: t('errorVerifying') },
      { status: 500 }
    );
  }
}
