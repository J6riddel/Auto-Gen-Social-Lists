/**
 * Full-name -> mascot-name lookup, shared by the render layer (short display
 * names) and the fetch layer (joining a brand-grouped entity name to an
 * Instagram-grouped one when Socialpruf doesn't use the same full/short
 * convention for the same team in both places — confirmed on nfl-league:
 * groupBy=brand scoped to youtube named an entity "Browns", the Instagram
 * groupBy=account query named the same entity "Cleveland Browns", and a raw
 * lowercase string match between the two missed every team where the two
 * queries disagreed on which form to use.
 */

const NHL_SHORT_NAMES: Record<string, string> = {
  "anaheim ducks": "Ducks",
  "arizona coyotes": "Coyotes",
  "boston bruins": "Bruins",
  "buffalo sabres": "Sabres",
  "calgary flames": "Flames",
  "carolina hurricanes": "Hurricanes",
  "chicago blackhawks": "Blackhawks",
  "colorado avalanche": "Avalanche",
  "columbus blue jackets": "Blue Jackets",
  "dallas stars": "Stars",
  "detroit red wings": "Red Wings",
  "edmonton oilers": "Oilers",
  "florida panthers": "Panthers",
  "los angeles kings": "Kings",
  "minnesota wild": "Wild",
  "montreal canadiens": "Canadiens",
  "nashville predators": "Predators",
  "new jersey devils": "Devils",
  "new york islanders": "Islanders",
  "new york rangers": "Rangers",
  "ottawa senators": "Senators",
  "philadelphia flyers": "Flyers",
  "pittsburgh penguins": "Penguins",
  "san jose sharks": "Sharks",
  "seattle kraken": "Kraken",
  "st. louis blues": "Blues",
  "st louis blues": "Blues",
  "tampa bay lightning": "Lightning",
  "toronto maple leafs": "Maple Leafs",
  "utah hockey club": "Hockey Club",
  "utah mammoth": "Mammoth",
  "vancouver canucks": "Canucks",
  "vegas golden knights": "Golden Knights",
  "washington capitals": "Capitals",
  "winnipeg jets": "Jets",
};

const NFL_SHORT_NAMES: Record<string, string> = {
  "arizona cardinals": "Cardinals",
  "atlanta falcons": "Falcons",
  "baltimore ravens": "Ravens",
  "buffalo bills": "Bills",
  "carolina panthers": "Panthers",
  "chicago bears": "Bears",
  "cincinnati bengals": "Bengals",
  "cleveland browns": "Browns",
  "dallas cowboys": "Cowboys",
  "denver broncos": "Broncos",
  "detroit lions": "Lions",
  "green bay packers": "Packers",
  "houston texans": "Texans",
  "indianapolis colts": "Colts",
  "jacksonville jaguars": "Jaguars",
  "kansas city chiefs": "Chiefs",
  "las vegas raiders": "Raiders",
  "los angeles chargers": "Chargers",
  "los angeles rams": "Rams",
  "miami dolphins": "Dolphins",
  "minnesota vikings": "Vikings",
  "new england patriots": "Patriots",
  "new orleans saints": "Saints",
  "new york giants": "Giants",
  "new york jets": "Jets",
  "philadelphia eagles": "Eagles",
  "pittsburgh steelers": "Steelers",
  "san francisco 49ers": "49ers",
  "seattle seahawks": "Seahawks",
  "tampa bay buccaneers": "Buccaneers",
  "tennessee titans": "Titans",
  "washington commanders": "Commanders",
};

const NBA_SHORT_NAMES: Record<string, string> = {
  "atlanta hawks": "Hawks",
  "boston celtics": "Celtics",
  "brooklyn nets": "Nets",
  "charlotte hornets": "Hornets",
  "chicago bulls": "Bulls",
  "cleveland cavaliers": "Cavaliers",
  "dallas mavericks": "Mavericks",
  "denver nuggets": "Nuggets",
  "detroit pistons": "Pistons",
  "golden state warriors": "Warriors",
  "houston rockets": "Rockets",
  "indiana pacers": "Pacers",
  "los angeles clippers": "Clippers",
  "los angeles lakers": "Lakers",
  "memphis grizzlies": "Grizzlies",
  "miami heat": "Heat",
  "milwaukee bucks": "Bucks",
  "minnesota timberwolves": "Timberwolves",
  "new orleans pelicans": "Pelicans",
  "new york knicks": "Knicks",
  "oklahoma city thunder": "Thunder",
  "orlando magic": "Magic",
  "philadelphia 76ers": "76ers",
  "phoenix suns": "Suns",
  "portland trail blazers": "Trail Blazers",
  "sacramento kings": "Kings",
  "san antonio spurs": "Spurs",
  "toronto raptors": "Raptors",
  "utah jazz": "Jazz",
  "washington wizards": "Wizards",
};

const MLB_SHORT_NAMES: Record<string, string> = {
  "arizona diamondbacks": "Diamondbacks",
  "atlanta braves": "Braves",
  "baltimore orioles": "Orioles",
  "boston red sox": "Red Sox",
  "chicago cubs": "Cubs",
  "chicago white sox": "White Sox",
  "cincinnati reds": "Reds",
  "cleveland guardians": "Guardians",
  "colorado rockies": "Rockies",
  "detroit tigers": "Tigers",
  "houston astros": "Astros",
  "kansas city royals": "Royals",
  "los angeles angels": "Angels",
  "los angeles dodgers": "Dodgers",
  "miami marlins": "Marlins",
  "milwaukee brewers": "Brewers",
  "minnesota twins": "Twins",
  "new york mets": "Mets",
  "new york yankees": "Yankees",
  "oakland athletics": "Athletics",
  athletics: "Athletics", // mid-relocation, no city in the official name
  "philadelphia phillies": "Phillies",
  "pittsburgh pirates": "Pirates",
  "san diego padres": "Padres",
  "san francisco giants": "Giants",
  "seattle mariners": "Mariners",
  "st. louis cardinals": "Cardinals",
  "st louis cardinals": "Cardinals",
  "tampa bay rays": "Rays",
  "texas rangers": "Rangers",
  "toronto blue jays": "Blue Jays",
  "washington nationals": "Nationals",
};

// Merged across leagues rather than kept as four lookups picked by org — full
// team names don't collide across leagues (every "New York ___"/"Los Angeles
// ___"/"Washington ___" etc. has a different mascot), so one flat table keeps
// callers ignorant of which league they're handling.
export const TEAM_SHORT_NAMES: Record<string, string> = {
  ...NHL_SHORT_NAMES,
  ...NFL_SHORT_NAMES,
  ...NBA_SHORT_NAMES,
  ...MLB_SHORT_NAMES,
};

/** Mascot-only display form. An unmatched name (a non-league org, or a name
 *  typo'd differently than expected) just falls back to the full name
 *  unchanged — "degrade, don't break," same pattern as a dead logo URL. */
export function displayTeamName(name: string): string {
  return TEAM_SHORT_NAMES[name.trim().toLowerCase()] ?? name;
}

/** Lowercase mascot-only key, for matching the same team across two calls
 *  that don't agree on full-vs-short form. Names already in short form pass
 *  through unchanged (the table's values, not just its keys, are mascot
 *  names), so this only needs one direction of lookup.
 *
 *  Strips anything that isn't a letter/digit/space/basic punctuation before
 *  the table lookup — confirmed on nba-league: the Knicks' tracked Instagram
 *  account has a "🏀" baked into its own display name ("New York Knicks 🏀"),
 *  which survived a plain trim/lowercase and produced a key the table (and
 *  the other side of the join) never had. */
export function canonicalTeamKey(name: string): string {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^\p{L}\p{N}\s.'-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return (TEAM_SHORT_NAMES[key] ?? key).toLowerCase();
}
