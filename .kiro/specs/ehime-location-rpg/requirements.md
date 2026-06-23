# Requirements Document

## Introduction

Ehime Location RPG is a mobile-first React web application that turns real-world travel through Ehime Prefecture into a role-playing game. Players physically visit tourist spots and landmarks to collect stamps, complete quests, defeat area bosses, and unlock new regions. Walking and visiting spots earn coins and experience points that drive RPG-style growth: players buy and equip gear in a shop, level up a character, earn titles, and complete collections. Social features let players share photo memories and connect with nearby friends.

This document scopes the **MVP** (Requirements 1-12) as the primary deliverable and documents **Later-Phase** features (Requirements 13-17) for subsequent development. The application uses a React mobile web front end, an AWS-hosted data backend, and is deployed on Vercel with a header / main / footer layout and menu navigation.

The three product pillars are:
1. **Going to real locations is the game** — visiting spots advances stamps, quests, boss battles, and map unlocking.
2. **RPG growth feeling** — experience, coins, equipment, titles, and collections create a sense of leveling up.
3. **Play together** — sharing photos and connecting with nearby friends builds community (later phase).

## Glossary

- **Application**: The Ehime Location RPG React web client running in a mobile browser.
- **Location_Service**: The component that obtains the player's geographic position and determines spot entry.
- **Spot_Manager**: The component that stores spot definitions, locations, regions, and unlock order.
- **Stamp_System**: The component that records and displays stamps earned by visiting spots.
- **Quest_System**: The component that tracks quest definitions, progress, and completion.
- **Reward_Engine**: The component that calculates coins, experience points, and items earned from player activity.
- **Shop**: The component that lists purchasable items and processes coin transactions.
- **Character_System**: The component that manages the player character's level, equipment, and stats.
- **Title_System**: The component that grants and displays achievement titles.
- **Collection_System**: The component that tracks completion of stamp, boss, and item collections.
- **Boss_System**: The component that manages area bosses and battle resolution.
- **Map_System**: The component that renders the map and controls regional area unlocking.
- **User_Data_Store**: The AWS-hosted backend that persists player coins, experience, owned items, equipment, titles, and visit history.
- **Friend_Service**: The component that manages friend relationships and consent-based visibility (later phase).
- **Photo_Service**: The component that manages photo posts and likes (later phase).
- **Party_Service**: The component that forms temporary groups of nearby players (later phase).
- **Spot**: A real-world tourist location or landmark with a defined coordinate and entry radius.
- **Entry_Radius**: The distance in meters from a Spot center within which a player is considered present at that Spot.
- **Region**: A geographic grouping of Spots that unlocks as a unit.
- **Stamp**: A record proving a player visited a specific Spot.
- **Experience_Points**: A numeric value that accumulates from player activity and determines character level.
- **Coins**: The in-game currency earned from activity and spent in the Shop.
- **First_Visit**: The first time a player enters a specific Spot.
- **Limited_Item**: An item obtainable only as a boss reward and not purchasable in the Shop.

## Requirements

### Requirement 1: Location Detection (MVP)

**User Story:** As a player, I want the application to detect when I arrive at a tourist spot, so that visiting real locations advances my game progress.

#### Acceptance Criteria

1. WHEN a player grants location permission, THE Location_Service SHALL obtain the player's current latitude and longitude with a horizontal accuracy of 50 meters or better.
2. IF the player's reported position has a horizontal accuracy worse than 50 meters, THEN THE Location_Service SHALL discard that position and SHALL NOT register the player as present at any Spot.
3. WHEN the player's position is within the Entry_Radius of exactly one Spot, THE Location_Service SHALL register the player as present at that Spot.
4. WHEN the player's position is within the Entry_Radius of two or more Spots, THE Location_Service SHALL register the player as present only at the Spot whose center coordinate is nearest to the player's position.
5. WHILE the player's position remains outside the Entry_Radius of all Spots, THE Location_Service SHALL report no current Spot.
6. IF the player denies location permission, THEN THE Application SHALL display a message indicating that location access is required to earn stamps.
7. IF the Location_Service cannot obtain a position with a horizontal accuracy of 50 meters or better within 30 seconds, THEN THE Application SHALL display a retry option and SHALL retain any previously registered Spot presence.
8. THE Spot_Manager SHALL define each Spot with a center coordinate and an Entry_Radius between 20 meters and 200 meters.

### Requirement 2: Map and Spot Display (MVP)

**User Story:** As a player, I want to see spots on a map, so that I know where to travel next.

#### Acceptance Criteria

1. WHEN a player position with a horizontal accuracy of 50 meters or better is available, THE Map_System SHALL display a map centered on the player's current position within 3 seconds.
2. THE Map_System SHALL display a distinct marker for each unlocked Spot within the currently unlocked and visible Regions.
3. WHERE a Spot is locked, THE Map_System SHALL display that Spot in a locked visual state that is visually distinct from the unlocked state and SHALL NOT reveal the Spot's reward details.
4. WHEN a player selects an unlocked Spot marker, THE Application SHALL display the Spot name, description, and visit status as either "visited" or "not visited".
5. WHEN a player selects a locked Spot marker, THE Application SHALL indicate that the Spot is locked without revealing the Spot's name, description, or reward details.
6. IF no player position is available, THEN THE Map_System SHALL center the map on a default coordinate within Ehime Prefecture.
7. IF the Map_System fails to load or center the map within 10 seconds, THEN THE Application SHALL display a message indicating that the map could not be loaded and provide a retry option.

### Requirement 3: Stamp Acquisition (MVP)

**User Story:** As a player, I want to earn a stamp when I visit a spot, so that I have a record of where I have been.

#### Acceptance Criteria

1. WHEN the Location_Service registers a player as present at a Spot for which the player has no existing Stamp, THE Stamp_System SHALL grant exactly one Stamp for that Spot.
2. WHEN a Stamp is granted, THE User_Data_Store SHALL persist the Stamp with the Spot identifier and the date and time at which the Stamp was granted.
3. IF a player is present at a Spot for which a Stamp already exists, THEN THE Stamp_System SHALL retain the existing Stamp without creating a duplicate and SHALL leave the existing Stamp's stored Spot identifier and timestamp unchanged.
4. IF persisting a granted Stamp to the User_Data_Store fails, THEN THE Stamp_System SHALL not record the Stamp as earned and SHALL present an indication to the player that the Stamp was not saved.
5. WHEN the player views the Stamp collection, THE Stamp_System SHALL display the count of Stamps earned as an integer from 0 to the total count of available Stamps, together with the total count of available Stamps.

### Requirement 4: Quest Progress and Completion (MVP)

**User Story:** As a player, I want quests that advance as I visit spots, so that I have goals to pursue.

#### Acceptance Criteria

1. THE Quest_System SHALL define each quest with either a set of 1 to 100 required Spots or a required Stamp count between 1 and 100.
2. WHEN a Stamp is granted for a Spot that is a required Spot of an active quest, THE Quest_System SHALL increment that quest's progress by one, counting each required Spot at most once.
3. IF a Stamp is granted for a Spot that has already been counted toward an active quest, THEN THE Quest_System SHALL leave that quest's progress unchanged.
4. WHEN a quest's satisfied condition count equals its total required condition count, THE Quest_System SHALL mark that quest as complete.
5. WHEN a quest transitions to complete, THE Reward_Engine SHALL grant the quest's defined Coins and Experience_Points exactly once for that quest.
6. IF granting the quest's Coins and Experience_Points fails, THEN THE Reward_Engine SHALL retain the quest's complete state, leave the player's Coins and Experience_Points unchanged, and return an error indication that the reward grant failed.
7. WHILE a quest is in the active state, THE Quest_System SHALL display that quest's current satisfied condition count, total required condition count, and the list of remaining unsatisfied conditions.
8. WHILE any condition of a quest is unsatisfied, THE Quest_System SHALL keep that quest in the incomplete state.

### Requirement 5: Coin and Experience Rewards (MVP)

**User Story:** As a player, I want to earn coins and experience from walking and exploring, so that I have a clear reason to keep moving.

#### Acceptance Criteria

1. WHEN a player records walking distance, THE Reward_Engine SHALL grant 1 Coin for each complete 100 meters of distance traveled.
2. WHEN a player records walking distance that contains a remainder of fewer than 100 meters, THE Reward_Engine SHALL carry the remainder distance forward toward the next 100-meter increment and SHALL grant no Coins for that remainder.
3. WHEN a First_Visit to a Spot occurs, THE Reward_Engine SHALL grant the non-negative first-visit Coins and Experience_Points configured for that Spot.
4. WHEN a player defeats a boss, THE Reward_Engine SHALL grant the non-negative Coins, Experience_Points, and rewards configured for that boss.
5. WHEN the Reward_Engine grants Coins or Experience_Points, THE User_Data_Store SHALL increase the player's persisted totals by exactly the granted amounts.
6. THE Reward_Engine SHALL grant a Coin value of 0 or greater and an Experience_Points value of 0 or greater for every reward calculation.
7. IF the User_Data_Store fails to persist granted Coins or Experience_Points, THEN THE Reward_Engine SHALL leave the player's prior persisted totals unchanged and SHALL return an error indication identifying the failed grant.

### Requirement 6: Character Growth and Leveling (MVP)

**User Story:** As a player, I want my character to level up as I gain experience, so that I feel a sense of progression.

#### Acceptance Criteria

1. THE Character_System SHALL assign each player an integer level ranging from 1 (minimum, the starting level for new players) to 99 (maximum), derived from accumulated Experience_Points, where new players begin at level 1 with 0 Experience_Points.
2. WHEN a player's Experience_Points reach or exceed the threshold for the next level, THE Character_System SHALL increase the player's level by one for each level threshold crossed in a single gain, up to the maximum level of 99.
3. WHEN a player's level increases, THE Application SHALL display a level-up notification showing the new level for a minimum of 3 seconds or until the player explicitly dismisses it.
4. WHILE a player is below the maximum level of 99, THE Character_System SHALL display the player's current level, current Experience_Points, and the Experience_Points required to reach the next level.
5. WHILE a player is at the maximum level of 99, THE Character_System SHALL display the player's current level and current Experience_Points and indicate that the maximum level has been reached in place of the next-level requirement.
6. IF an operation would set a player's Experience_Points to a value below 0, THEN THE Character_System SHALL reject the change, retain the previous Experience_Points value, and display an error indication that the value is invalid.

### Requirement 7: Shop and Purchasing (MVP)

**User Story:** As a player, I want to spend coins on equipment and items in a shop, so that my character grows stronger.

#### Acceptance Criteria

1. THE Shop SHALL display each purchasable item with a name, a Coin price between 1 and 999,999,999 inclusive, and an effect description of up to 280 characters.
2. WHEN a player purchases an item and the player's Coin balance is greater than or equal to the item price, THE Shop SHALL deduct the item price from the player's Coins and add the item to the player's owned items within 2 seconds.
3. IF a player attempts to purchase an item and the player's Coin balance is less than the item price, THEN THE Shop SHALL reject the purchase, leave the player's Coin balance and owned items unchanged, and display a message indicating insufficient coins.
4. WHEN a purchase completes, THE User_Data_Store SHALL persist the updated Coin balance and owned items.
5. THE Shop SHALL exclude every Limited_Item from the purchasable item list.
6. IF persistence of a completed purchase fails, THEN THE Shop SHALL retain the purchased item and the updated Coin balance in the player's session state and retry persistence on the next data synchronization for up to 3 attempts.
7. IF persistence of a completed purchase fails on 3 consecutive synchronization attempts, THEN THE Shop SHALL display a message indicating the purchase could not be saved and SHALL preserve the purchased item and the updated Coin balance in the player's session state.
8. WHEN a purchase completes successfully, THE Shop SHALL display a message confirming that the item was added to the player's owned items.

### Requirement 8: Equipment Management (MVP)

**User Story:** As a player, I want to change my character's equipment, so that I can customize my RPG character.

#### Acceptance Criteria

1. THE Character_System SHALL display the player's owned equipment items grouped by equipment slot, with each item appearing only under the slot it can be equipped to.
2. WHILE a slot has no owned items, THE Character_System SHALL display an empty-state indication for that slot.
3. WHEN a player equips an owned item to its corresponding slot, THE Character_System SHALL set that item as the active item for the slot and unequip any previously active item in that slot.
4. IF a player attempts to equip an item that is not owned or does not correspond to the target slot, THEN THE Character_System SHALL reject the change, retain the slot's current active item, and present an indication that the equip action was invalid.
5. WHEN equipment changes, THE User_Data_Store SHALL persist the player's active equipment per slot.
6. IF persisting the player's active equipment fails, THEN THE Character_System SHALL revert the affected slot to its last successfully persisted active item and present an indication that the change was not saved.
7. WHEN the player's active equipment changes, THE Character_System SHALL recompute and apply the combined stat effects of all active equipment to the player's character stats.
8. WHILE a slot has no active item, THE Character_System SHALL apply no stat effects from that slot to the player's character stats.

### Requirement 9: Boss Battles (MVP)

**User Story:** As a player, I want to fight area bosses when I reach their location, so that exploration leads to challenges and rewards.

#### Acceptance Criteria

1. THE Boss_System SHALL associate each boss with exactly one Spot or one Region and define that boss's reward set as containing Coins, Experience_Points, and at least one Limited_Item.
2. WHERE a player has entered the Region or Spot of a boss, THE Boss_System SHALL make that boss battle available.
3. WHEN a player wins a boss battle, THE Boss_System SHALL grant the boss's defined rewards through the Reward_Engine and record the boss as defeated for that player.
4. WHEN a player wins a boss battle for a boss they have already defeated, THE Boss_System SHALL grant the boss's Coins and Experience_Points and SHALL grant the boss's Limited_Item reward only if that Limited_Item has not already been granted to that player.
5. WHEN a boss is recorded as defeated, THE User_Data_Store SHALL persist the defeated state for that player.
6. IF a player loses or abandons a boss battle, THEN THE Boss_System SHALL not record the boss as defeated, SHALL grant no rewards, and SHALL keep that boss battle available.
7. WHILE a player has not entered the Region or Spot of a boss, THE Boss_System SHALL keep that boss battle unavailable.

### Requirement 10: Regional Map Unlocking (MVP)

**User Story:** As a player, I want new regions to unlock as I progress, so that I always have a new area to explore.

#### Acceptance Criteria

1. THE Map_System SHALL define a deterministic, total unlock order for all Regions in which each Region except the first has exactly one immediately preceding Region.
2. WHEN a new player account is created, THE Map_System SHALL set the first Region in the unlock order to the unlocked state and set all other Regions to the locked state.
3. WHEN a player satisfies the unlock condition of the next locked Region in the unlock order, THE Map_System SHALL change that Region to the unlocked state within 2 seconds of the condition being satisfied.
4. WHEN a Region changes to the unlocked state, THE User_Data_Store SHALL persist the unlocked state for that player before the unlock is presented to the player as complete.
5. IF persisting the unlocked state fails, THEN THE Map_System SHALL retain the affected Region in its prior locked state, present an error indication to the player that the unlock could not be saved, and retry persistence up to 3 attempts.
6. WHEN a Region changes to the unlocked state and the unlocked state is persisted, THE Map_System SHALL present a notification to the player identifying the newly unlocked Region.
7. WHILE a Region's unlock condition is unmet, THE Map_System SHALL keep that Region in the locked state and prevent the player from entering that Region.

### Requirement 11: Titles and Collections (MVP)

**User Story:** As a player, I want to earn titles and complete collections, so that my achievements are recorded and I am motivated to keep playing.

#### Acceptance Criteria

1. THE Title_System SHALL define each title with exactly one achievement condition, where the condition is a measurable completion state such as visiting all Spots in a Region or defeating all bosses in a Region.
2. WHEN a player satisfies a title's achievement condition AND the player has not already been granted that title, THE Title_System SHALL grant that title to the player within 1 second of the condition being satisfied.
3. IF a player satisfies a title's achievement condition AND the player has already been granted that title, THEN THE Title_System SHALL NOT grant the title again and SHALL leave the player's existing titles unchanged.
4. WHEN a title is granted, THE User_Data_Store SHALL persist the title for that player.
5. IF persisting a granted title fails, THEN THE User_Data_Store SHALL retain the player's previously persisted titles unchanged and SHALL return an error indication reporting the persistence failure.
6. THE Collection_System SHALL display each collection with the count of obtained entries and the total count of entries, where the obtained count is in the range 0 to the total count.
7. WHEN a player obtains the final entry of a collection whose total count of entries is 1 or greater, THE Collection_System SHALL mark that collection as complete.
8. WHERE a collection has a total count of zero entries, THE Collection_System SHALL keep that collection incomplete.

### Requirement 12: Mobile-First Layout and Navigation (MVP)

**User Story:** As a player, I want a clear mobile layout with easy navigation, so that I can use the app comfortably on my smartphone.

#### Acceptance Criteria

1. THE Application SHALL render a layout composed of a header region, a main content region, and a footer region.
2. THE Application SHALL provide menu navigation to the map, character, shop, quests, and collections views.
3. WHEN a player selects a navigation menu item, THE Application SHALL display the corresponding view in the main content region within 1 second.
4. WHERE the viewport width is 480 pixels or less, THE Application SHALL render all interactive controls fully within the viewport width without horizontal scrolling.
5. WHERE the viewport width is 480 pixels or less, THE Application SHALL render each interactive control with a minimum touch target size of 44 by 44 pixels.
6. WHEN the Application loads in a mobile browser, THE Application SHALL retrieve the player's persisted data from the User_Data_Store within 10 seconds.
7. WHILE the player's persisted data is being retrieved from the User_Data_Store, THE Application SHALL display a loading indicator in the main content region.
8. IF retrieval of the player's persisted data does not complete within 10 seconds, THEN THE Application SHALL display a message indicating that player data could not be loaded and provide a retry option.

### Requirement 13: Friend Connections (Later Phase)

**User Story:** As a player, I want to connect with friends and control what they can see, so that I can play socially while protecting my privacy.

#### Acceptance Criteria

1. WHEN a player sends a friend request to another existing player who is not already a friend and has no pending request between the two players, THE Friend_Service SHALL record a pending friend request from the sender to the recipient.
2. WHEN a recipient accepts a pending friend request, THE Friend_Service SHALL establish a mutual friend relationship between the two players and remove the pending request.
3. IF a player sends a friend request to themselves, to a player who is already a friend, or to a player with whom a pending request already exists, THEN THE Friend_Service SHALL reject the request without creating a pending request and display a message indicating the request cannot be sent.
4. WHERE a player has granted location-sharing consent to a friend, THE Friend_Service SHALL share the player's position rounded to no finer than 100 meters with that friend only while the two players are within 500 meters of each other.
5. WHILE a player has not granted location-sharing consent to a friend, THE Friend_Service SHALL withhold the player's position and any proximity indicator from that friend.
6. WHEN a player revokes location-sharing consent, THE Friend_Service SHALL stop sharing the player's position with the affected friend within 5 seconds.

### Requirement 14: Photo Posting and Likes (Later Phase)

**User Story:** As a player, I want to post photos and like others' photos, so that I can save memories and build community.

#### Acceptance Criteria

1. WHEN a player posts a photo of no more than 10 MB in a supported image format associated with an existing Spot, THE Photo_Service SHALL store the photo with the Spot identifier, the author identifier, and the post timestamp.
2. IF a player attempts to post a photo that exceeds 10 MB, is not in a supported image format, or references a Spot that does not exist, THEN THE Photo_Service SHALL reject the post, retain no partial photo data, and return an error indicating the reason for rejection.
3. IF storing a posted photo fails, THEN THE Photo_Service SHALL not create a photo record and SHALL return an error indicating the photo could not be saved.
4. WHEN a player opens the photo feed, THE Photo_Service SHALL display posted photos in pages of up to 20 photos ordered by post timestamp in descending order with the most recent photo first.
5. WHEN a player who has not previously liked a photo likes that photo, THE Photo_Service SHALL increase that photo's like count by exactly one and record that player as having liked that photo.
6. IF a player who has already liked a photo attempts to like that photo again, THEN THE Photo_Service SHALL keep that photo's like count unchanged and SHALL return an indication that the photo is already liked by that player.

### Requirement 15: Nearby Parties (Later Phase)

**User Story:** As a player, I want to form a party with nearby friends, so that we can explore together.

#### Acceptance Criteria

1. WHERE one or more consenting friends are located within 50 meters of the initiating player, THE Party_Service SHALL allow those players to form a party of up to 4 members.
2. WHEN a player joins a party and the party has fewer than 4 members, THE Party_Service SHALL add the player to the party member list within 2 seconds.
3. IF a player attempts to join a party that already contains 4 members, THEN THE Party_Service SHALL reject the join request and return an error indicating the party is full, leaving the existing party member list unchanged.
4. WHEN a player leaves a party, THE Party_Service SHALL remove the player from the party member list within 2 seconds.
5. WHEN a player leaves a party and zero members remain, THE Party_Service SHALL disband the party.

### Requirement 16: Real-Time Battles (Later Phase)

**User Story:** As a player, I want to participate in real-time battles with others, so that cooperative play feels dynamic.

#### Acceptance Criteria

1. WHEN a party member at a boss location requests to join a shared boss battle and the battle has fewer than 4 active participants, THE Boss_System SHALL add that party member to the shared boss battle within 2 seconds of the request.
2. IF a party member requests to join a shared boss battle that already has 4 active participants, THEN THE Boss_System SHALL deny the request, retain the existing participants unchanged, and display a battle-full message to the requesting member.
3. WHEN a shared boss battle is won, THE Reward_Engine SHALL grant rewards to each party member who was an active participant at the moment the battle was won, within 5 seconds of the win.
4. IF a participating party member loses network connectivity for more than 30 seconds during a shared boss battle, THEN THE Boss_System SHALL remove that member from the active participant list and continue the battle for the remaining participants.
5. WHEN a shared boss battle is lost or its 600-second time limit elapses without a win, THE Reward_Engine SHALL grant no battle rewards to any participant and THE Boss_System SHALL display a battle-ended message to each participant.

### Requirement 17: Regional Events (Later Phase)

**User Story:** As a player, I want time-limited regional events, so that there are fresh reasons to revisit areas.

#### Acceptance Criteria

1. THE Spot_Manager SHALL define each regional event with a unique event identifier, an associated Region, a start time, and an end time, where the end time is later than the start time.
2. WHILE the current time is at or after a regional event's start time and before its end time, THE Quest_System SHALL make that event's quests available in the associated Region.
3. WHEN the current time reaches a regional event's end time, THE Quest_System SHALL make that event's quests unavailable.
4. WHILE the current time is before a regional event's start time, THE Quest_System SHALL keep that event's quests unavailable.
5. IF a regional event's end time is not later than its start time, THEN THE Spot_Manager SHALL reject that event definition and exclude its quests from availability.
6. WHEN the current time reaches a regional event's end time while a player has an in-progress quest from that event, THE Quest_System SHALL stop further progress on that quest and grant no rewards for the unsatisfied quest.
