# Innehållsrapport

Innehållsversion `0a3e3d6c8d1239678a3ade12cc507a4f0cd712809537b8f96e9aefe6af734962`.

**Uppfyller innehållsgränserna.** Gränserna är 2000 spelbara begrepp och 100 användbara ordpar per språk, spelbart innehåll i obligatoriska och övriga listade kategorier och inga strukturella fel.

Katalogen innehåller **2319 unika begrepp** och **255 unika ordpar** efter automatisk avdubblering. Svenska och engelska räknas tillsammans som ett begrepp per ord-ID.

## Spelbart innehåll

Tabellen räknar alla kunskapsnivåer. Ett par räknas i en kategori när båda orden ingår där. Par mellan kategorier ingår i totalen och kan användas när båda kategorierna är valda.

| Kategori | Ord SV | Ledtrådar SV | Par SV | Ord EN | Ledtrådar EN | Par EN |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Minecraft (`minecraft`) | 176 | 528 | 14 | 176 | 528 | 14 |
| Clash Royale (`clash-royale`) | 122 | 366 | 12 | 122 | 366 | 12 |
| Spel (`games`) | 128 | 384 | 10 | 128 | 384 | 10 |
| Vardagsföremål (`everyday`) | 191 | 573 | 25 | 191 | 573 | 25 |
| Teknologi (`technology`) | 190 | 570 | 24 | 190 | 570 | 24 |
| Mat och dryck (`food`) | 205 | 615 | 35 | 205 | 615 | 35 |
| Djur (`animals`) | 199 | 597 | 33 | 199 | 597 | 33 |
| Natur (`nature`) | 132 | 396 | 10 | 132 | 396 | 10 |
| Sport och fritid (`sports`) | 137 | 411 | 10 | 137 | 411 | 10 |
| Fordon (`vehicles`) | 125 | 375 | 8 | 125 | 375 | 8 |
| Film och serier (`film-tv`) | 128 | 384 | 19 | 128 | 384 | 19 |
| Musik (`music`) | 130 | 390 | 11 | 130 | 390 | 11 |
| Platser och resor (`travel`) | 137 | 411 | 11 | 137 | 411 | 11 |
| Yrken (`occupations`) | 108 | 324 | 13 | 108 | 324 | 13 |
| Hem, skola och kläder (`home-school-clothes`) | 211 | 633 | 20 | 211 | 633 | 20 |
| Mellan kategorier | — | — | 0 | — | — | 0 |
| **Totalt** | 2319 | 6957 | 255 | 2319 | 6957 | 255 |

På nivån Välkända finns **484** begrepp, på Mellannivå **1519** och på Expert **316**.

Med standardnivån `familiar` och alla kategorier valda finns 484 svenska begrepp och 54 svenska par samt 484 engelska begrepp och 54 engelska par.

## Automatisk validering

Valideringen kontrollerar JSON, obligatoriska fält, språkversioner, unika identifierare, namn, parreferenser och att varje ledtråd består av ett ord. Övriga kontroller av ledtrådstext hittar mönster att gå igenom manuellt.

- Strukturella fel **0**
- Dublett- och aliashändelser **0**
- Saknade obligatoriska fält **0**
- Ledtrådar som återkommer för minst 3 begrepp i samma kategori, språk och ledtrådsnivå **214**
- Träffar på generiska ledtrådar **0**
- Ledtrådar med ordet, en direkt översättning eller ett angivet alias **0**

### Återanvända ledtrådar

| Språk | Kategori | Ledtrådsnivå | Normaliserad ledtråd | Antal begrepp | Ord-ID |
| --- | --- | --- | --- | ---: | --- |
| en | minecraft | easy | nether | 10 | minecraft-ancient-debris, minecraft-blaze, minecraft-crimson-forest, minecraft-ghast-tear, minecraft-glowstone, minecraft-hoglin, minecraft-magma-cube, minecraft-obsidian, minecraft-respawn-anchor, minecraft-warped-forest |
| sv | minecraft | easy | nether | 8 | minecraft-ancient-debris, minecraft-blaze, minecraft-crimson-forest, minecraft-ghast-tear, minecraft-glowstone, minecraft-hoglin, minecraft-magma-cube, minecraft-respawn-anchor |
| en | clash-royale | easy | bones | 7 | clash-royale-graveyard, clash-royale-guards, clash-royale-skeleton-army, clash-royale-skeleton-dragons, clash-royale-skeleton-king, clash-royale-tombstone, clash-royale-wall-breakers |
| en | minecraft | normal | nether | 6 | minecraft-bedrock, minecraft-crying-obsidian, minecraft-fire-charge, minecraft-lodestone, minecraft-netherite-ingot, minecraft-ruined-portal |
| en | music | hard | orchestra | 6 | music-flute, music-oboe, music-opera, music-overture, music-timpani, music-tuba |
| sv | music | hard | orkester | 6 | music-flute, music-oboe, music-opera, music-overture, music-timpani, music-tuba |
| en | clash-royale | hard | defense | 5 | clash-royale-bomb-tower, clash-royale-goblin-hut, clash-royale-hog-rider, clash-royale-knight, clash-royale-tombstone |
| en | film-tv | easy | fbi | 5 | film-tv-clarice-starling, film-tv-dana-scully, film-tv-fox-mulder, film-tv-the-x-files, film-tv-twin-peaks |
| en | games | easy | hyrule | 5 | games-legend-of-zelda-breath-of-the-wild, games-link, games-master-sword, games-princess-zelda, games-triforce |
| sv | animals | normal | flock | 5 | animals-african-wild-dog, animals-american-bison, animals-baboon, animals-grey-wolf, animals-sheep |
| sv | clash-royale | hard | försvar | 5 | clash-royale-bomb-tower, clash-royale-goblin-hut, clash-royale-hog-rider, clash-royale-knight, clash-royale-tombstone |
| sv | everyday | normal | jord | 5 | everyday-bow-rake, everyday-garden-hoe, everyday-grow-bag, everyday-raised-bed, everyday-wheelbarrow |
| sv | film-tv | easy | fbi | 5 | film-tv-clarice-starling, film-tv-dana-scully, film-tv-fox-mulder, film-tv-the-x-files, film-tv-twin-peaks |
| sv | games | easy | hyrule | 5 | games-legend-of-zelda-breath-of-the-wild, games-link, games-master-sword, games-princess-zelda, games-triforce |
| en | animals | easy | spots | 4 | animals-jaguar, animals-leopard, animals-leopard-slug, animals-seven-spot-ladybird |
| en | animals | easy | stripes | 4 | animals-okapi, animals-perch, animals-tiger, animals-zebra |
| en | animals | easy | white | 4 | animals-beluga, animals-mute-swan, animals-snowy-owl, animals-stoat |
| en | animals | hard | climbing | 4 | animals-giant-panda, animals-north-american-porcupine, animals-pet-rat, animals-squirrel |
| en | animals | hard | dusk | 4 | animals-armadillo, animals-field-cricket, animals-golden-jackal, animals-mosquito |
| en | animals | hard | nocturnal | 4 | animals-badger, animals-fennec, animals-hamster, animals-kakapo |
| en | animals | normal | nocturnal | 4 | animals-atlas-moth, animals-bat, animals-eagle-owl, animals-european-earwig |
| en | animals | normal | venom | 4 | animals-adder, animals-black-widow, animals-king-cobra, animals-komodo-dragon |
| en | clash-royale | easy | jumper | 4 | clash-royale-electro-spirit, clash-royale-fire-spirit, clash-royale-heal-spirit, clash-royale-ice-spirit |
| en | clash-royale | hard | range | 4 | clash-royale-flying-machine, clash-royale-hunter, clash-royale-princess, clash-royale-spear-goblins |
| en | clash-royale | normal | attackers | 4 | clash-royale-bomb-tower, clash-royale-electro-giant, clash-royale-goblin-barrel, clash-royale-the-log |
| en | everyday | hard | handle | 4 | everyday-frying-pan, everyday-garden-trowel, everyday-hammare, everyday-saucepan |
| en | everyday | normal | soil | 4 | everyday-bow-rake, everyday-garden-hoe, everyday-raised-bed, everyday-wheelbarrow |
| en | everyday | normal | surface | 4 | everyday-bandslip, everyday-cutting-board, everyday-frying-pan, everyday-metallfil |
| en | food | easy | rice | 4 | food-bibimbap, food-biryani, food-paella, food-sushi |
| en | food | normal | broth | 4 | food-onion-soup, food-pho, food-ramen, food-risotto |
| en | food | normal | spices | 4 | food-biryani, food-dal, food-gingerbread-cookie, food-glogg |
| en | food | normal | stone | 4 | food-mango, food-nectarine, food-peach, food-plum |
| en | games | easy | pokémon | 4 | games-eevee, games-mewtwo, games-poke-ball, games-pokedex |
| en | home-school-clothes | normal | winter | 4 | home-school-clothes-beanie, home-school-clothes-down-jacket, home-school-clothes-mittens, home-school-clothes-scarf |
| en | minecraft | easy | enchantment | 4 | minecraft-lapis-lazuli, minecraft-mending, minecraft-silk-touch, minecraft-swift-sneak |
| en | music | easy | bars | 4 | music-glockenspiel, music-marimba, music-vibraphone, music-xylophone |
| en | music | normal | brass | 4 | music-saxophone, music-ska, music-trombone, music-trumpet |
| en | sports | hard | circle | 4 | sports-discus-throw, sports-faceoff, sports-shot-put, sports-softball |
| en | technology | easy | connection | 4 | technology-bandwidth, technology-mobile-hotspot, technology-serial-port, technology-usb-hub |
| en | technology | easy | wireless | 4 | technology-access-point, technology-bluetooth, technology-ssid, technology-wifi |
| en | technology | normal | charging | 4 | technology-docking-station, technology-earbuds, technology-power-bank, technology-usb-c |
| sv | animals | easy | fläckar | 4 | animals-african-wild-dog, animals-jaguar, animals-leopard, animals-leopard-slug |
| sv | animals | easy | taggar | 4 | animals-echidna, animals-hedgehog, animals-north-american-porcupine, animals-sea-urchin |
| sv | animals | normal | gift | 4 | animals-adder, animals-black-widow, animals-king-cobra, animals-komodo-dragon |
| sv | clash-royale | easy | benkrigare | 4 | clash-royale-graveyard, clash-royale-guards, clash-royale-skeleton-king, clash-royale-tombstone |
| sv | clash-royale | easy | hoppare | 4 | clash-royale-electro-spirit, clash-royale-fire-spirit, clash-royale-heal-spirit, clash-royale-ice-spirit |
| sv | clash-royale | hard | räckvidd | 4 | clash-royale-flying-machine, clash-royale-hunter, clash-royale-princess, clash-royale-spear-goblins |
| sv | clash-royale | normal | laddning | 4 | clash-royale-inferno-dragon, clash-royale-inferno-tower, clash-royale-sparky, clash-royale-zap |
| sv | everyday | hard | tänder | 4 | everyday-bow-rake, everyday-garden-fork, everyday-hedge-trimmer, everyday-metallsag |
| sv | food | normal | buljong | 4 | food-onion-soup, food-pho, food-ramen, food-risotto |
| sv | food | normal | kryddor | 4 | food-biryani, food-dal, food-gingerbread-cookie, food-glogg |
| sv | games | easy | pokémon | 4 | games-eevee, games-mewtwo, games-poke-ball, games-pokedex |
| sv | home-school-clothes | hard | veck | 4 | home-school-clothes-garment-steamer, home-school-clothes-kilt, home-school-clothes-sari, home-school-clothes-shoe-tree |
| sv | home-school-clothes | normal | vinter | 4 | home-school-clothes-beanie, home-school-clothes-down-jacket, home-school-clothes-mittens, home-school-clothes-scarf |
| sv | minecraft | normal | nether | 4 | minecraft-bedrock, minecraft-lodestone, minecraft-netherite-ingot, minecraft-ruined-portal |
| sv | technology | easy | trådlöst | 4 | technology-access-point, technology-bluetooth, technology-ssid, technology-wifi |
| en | animals | easy | echolocation | 3 | animals-bat, animals-bottlenose-dolphin, animals-harbour-porpoise |
| en | animals | easy | mustelid | 3 | animals-least-weasel, animals-pine-marten, animals-wolverine |
| en | animals | easy | shell | 3 | animals-galapagos-tortoise, animals-green-sea-turtle, animals-white-lipped-snail |
| en | animals | easy | spines | 3 | animals-echidna, animals-hedgehog, animals-sea-urchin |
| en | animals | hard | climber | 3 | animals-red-panda, animals-ring-tailed-lemur, animals-virginia-opossum |
| en | animals | hard | eyes | 3 | animals-chameleon, animals-dragonfly, animals-giant-squid |
| en | animals | hard | herd | 3 | animals-blue-wildebeest, animals-capybara, animals-elephant |
| en | animals | hard | scavenger | 3 | animals-gull, animals-tasmanian-devil, animals-wolverine |
| en | animals | hard | surface | 3 | animals-bottlenose-dolphin, animals-great-white-shark, animals-ocean-sunfish |
| en | animals | normal | desert | 3 | animals-dromedary, animals-fennec, animals-rattlesnake |
| en | animals | normal | migration | 3 | animals-crane, animals-greylag-goose, animals-monarch-butterfly |
| en | animals | normal | pouch | 3 | animals-seahorse, animals-virginia-opossum, animals-wombat |
| en | animals | normal | savannah | 3 | animals-blue-wildebeest, animals-giraffe, animals-zebra |
| en | animals | normal | speed | 3 | animals-ostrich, animals-peregrine-falcon, animals-sailfish |
| en | animals | normal | water | 3 | animals-american-mink, animals-capybara, animals-green-anaconda |
| en | clash-royale | easy | armor | 3 | clash-royale-mega-knight, clash-royale-mega-minion, clash-royale-pekka |
| en | clash-royale | easy | daggers | 3 | clash-royale-goblin-barrel, clash-royale-goblin-gang, clash-royale-goblins |
| en | clash-royale | easy | defender | 3 | clash-royale-cannoneer, clash-royale-dagger-duchess, clash-royale-royal-chef |
| en | clash-royale | easy | lightning | 3 | clash-royale-electro-wizard, clash-royale-sparky, clash-royale-tesla |
| en | clash-royale | easy | projectile | 3 | clash-royale-fireball, clash-royale-magic-archer, clash-royale-rocket |
| en | clash-royale | easy | rider | 3 | clash-royale-dark-prince, clash-royale-prince, clash-royale-ram-rider |
| en | clash-royale | hard | attack | 3 | clash-royale-dagger-duchess, clash-royale-goblin-drill, clash-royale-skeleton-king |
| en | clash-royale | hard | distance | 3 | clash-royale-bandit, clash-royale-electro-giant, clash-royale-mega-knight |
| en | clash-royale | hard | impact | 3 | clash-royale-battle-ram, clash-royale-giant-snowball, clash-royale-skeleton-barrel |
| en | clash-royale | hard | interruption | 3 | clash-royale-inferno-dragon, clash-royale-inferno-tower, clash-royale-lightning |
| en | clash-royale | normal | charging | 3 | clash-royale-inferno-dragon, clash-royale-lightning, clash-royale-zap |
| en | clash-royale | normal | defence | 3 | clash-royale-mega-minion, clash-royale-tesla, clash-royale-tower-princess |
| en | clash-royale | normal | explosion | 3 | clash-royale-fire-spirit, clash-royale-goblin-demolisher, clash-royale-wall-breakers |
| en | clash-royale | normal | range | 3 | clash-royale-pekka, clash-royale-vines, clash-royale-x-bow |
| en | clash-royale | normal | towers | 3 | clash-royale-freeze, clash-royale-minion-giant, clash-royale-royal-giant |
| en | everyday | easy | branches | 3 | everyday-garden-shredder, everyday-loppers, everyday-pruning-saw |
| en | everyday | easy | chopping | 3 | everyday-chefs-knife, everyday-cutting-board, everyday-food-processor |
| en | everyday | easy | holes | 3 | everyday-borrmaskin, everyday-dibber, everyday-slotted-spoon |
| en | everyday | hard | blade | 3 | everyday-fargskrapa, everyday-garden-spade, everyday-pappersskarare |
| en | everyday | hard | leverage | 3 | everyday-bottle-opener, everyday-garlic-press, everyday-loppers |
| en | everyday | normal | blade | 3 | everyday-brush-cutter, everyday-sticksag, everyday-tigersag |
| en | film-tv | normal | manhattan | 3 | film-tv-holly-golightly, film-tv-seinfeld, film-tv-when-harry-met-sally |
| en | film-tv | normal | umbrella | 3 | film-tv-mary-poppins, film-tv-overhead-shot, film-tv-singin-in-the-rain |
| en | food | easy | citrus | 3 | food-lemonade, food-mandarin, food-orange |
| en | food | easy | creamy | 3 | food-coconut-milk, food-risotto, food-scrambled-eggs |
| en | food | easy | green | 3 | food-lime, food-matcha, food-pistachios |
| en | food | easy | noodles | 3 | food-pad-thai, food-pho, food-ramen |
| en | food | easy | orange | 3 | food-carrot, food-cheese-puffs, food-sweet-potato |
| en | food | easy | purple | 3 | food-eggplant, food-plum, food-red-onion |
| en | food | hard | crunchy | 3 | food-bell-pepper, food-carrot, food-tacos |
| en | food | hard | lingonberries | 3 | food-meatballs, food-potato-dumplings, food-raggmunk |
| en | food | hard | orchard | 3 | food-apple, food-apple-juice, food-pear |
| en | food | hard | protein | 3 | food-beef-jerky, food-cottage-cheese, food-quinoa |
| en | food | hard | syrup | 3 | food-baklava, food-banana-split, food-stuffed-cabbage-rolls |
| en | food | normal | chewy | 3 | food-beef-jerky, food-chocolate-chip-cookie, food-toffee |
| en | food | normal | fried | 3 | food-arancini, food-falafel, food-samosa |
| en | food | normal | juicy | 3 | food-pear, food-tomato, food-watermelon |
| en | food | normal | seeds | 3 | food-apple, food-passion-fruit, food-pomegranate |
| en | food | normal | stew | 3 | food-beef-bourguignon, food-chili-con-carne, food-goulash |
| en | home-school-clothes | easy | bristles | 3 | home-school-clothes-scrubbing-brush, home-school-clothes-shoe-brush, home-school-clothes-toothbrush |
| en | home-school-clothes | hard | formal | 3 | home-school-clothes-bow-tie, home-school-clothes-evening-gown, home-school-clothes-tailcoat |
| en | home-school-clothes | hard | pressing | 3 | home-school-clothes-clothes-mangle, home-school-clothes-laundry-starch, home-school-clothes-pleated-skirt |
| en | home-school-clothes | normal | elastic | 3 | home-school-clothes-boxer-shorts, home-school-clothes-hair-tie, home-school-clothes-swim-trunks |
| en | minecraft | easy | water | 3 | minecraft-soul-sand, minecraft-sponge, minecraft-swamp |
| en | minecraft | hard | redstone | 3 | minecraft-breeze, minecraft-hopper, minecraft-sculk-sensor |
| en | minecraft | normal | footsteps | 3 | minecraft-deep-dark, minecraft-sculk-sensor, minecraft-soul-sand |
| en | minecraft | normal | sand | 3 | minecraft-nether-wart, minecraft-pottery-sherd, minecraft-wither |
| en | music | easy | bow | 3 | music-cello, music-viola, music-violin |
| en | music | easy | keys | 3 | music-celesta, music-clavichord, music-piano |
| en | music | easy | reed | 3 | music-bassoon, music-clarinet, music-oboe |
| en | music | easy | voices | 3 | music-a-cappella, music-counterpoint, music-fugue |
| en | music | hard | fingers | 3 | music-castanets, music-pizzicato, music-recorder |
| en | nature | normal | arctic | 3 | nature-aurora-borealis, nature-permafrost, nature-tundra |
| en | nature | normal | crystals | 3 | nature-cirrus, nature-halo, nature-sundog |
| en | nature | normal | slope | 3 | nature-avalanche, nature-landslide, nature-scree |
| en | sports | easy | gymnastics | 3 | sports-balance-beam, sports-parallel-bars, sports-pommel-horse |
| en | sports | easy | hoop | 3 | sports-basketball, sports-slam-dunk, sports-wheelchair-basketball |
| en | sports | easy | pool | 3 | sports-lane-line, sports-swimming, sports-water-polo |
| en | sports | hard | points | 3 | sports-assist, sports-taekwondo, sports-tiebreak |
| en | sports | normal | ball | 3 | sports-bandy, sports-football, sports-golf-tee |
| en | technology | easy | semiconductor | 3 | technology-led, technology-photodiode, technology-transistor |
| en | technology | normal | browser | 3 | technology-client, technology-http, technology-tls |
| en | travel | easy | japan | 3 | travel-himeji-castle, travel-kyoto, travel-tokyo |
| en | travel | easy | london | 3 | travel-big-ben, travel-tower-bridge, travel-united-kingdom |
| en | travel | easy | paris | 3 | travel-arc-de-triomphe, travel-eiffel-tower, travel-france |
| en | vehicles | easy | bed | 3 | vehicles-pickup, vehicles-sleeping-car, vehicles-tipper-truck |
| en | vehicles | easy | cargo | 3 | vehicles-barge, vehicles-container-ship, vehicles-station-wagon |
| en | vehicles | normal | blade | 3 | vehicles-bulldozer, vehicles-scraper, vehicles-snowplow |
| en | vehicles | normal | passengers | 3 | vehicles-ferry, vehicles-ocean-liner, vehicles-sedan |
| en | vehicles | normal | roadway | 3 | vehicles-cold-planer, vehicles-motor-grader, vehicles-road-rail-excavator |
| sv | animals | easy | horn | 3 | animals-moose, animals-rhinoceros, animals-water-buffalo |
| sv | animals | easy | ränder | 3 | animals-perch, animals-tiger, animals-zebra |
| sv | animals | easy | vit | 3 | animals-beluga, animals-mute-swan, animals-snowy-owl |
| sv | animals | hard | klättrare | 3 | animals-red-panda, animals-ring-tailed-lemur, animals-virginia-opossum |
| sv | animals | hard | nattaktiv | 3 | animals-badger, animals-fennec, animals-hamster |
| sv | animals | hard | skymning | 3 | animals-armadillo, animals-field-cricket, animals-golden-jackal |
| sv | animals | normal | pung | 3 | animals-koala, animals-virginia-opossum, animals-wombat |
| sv | animals | normal | savann | 3 | animals-blue-wildebeest, animals-giraffe, animals-zebra |
| sv | animals | normal | surr | 3 | animals-bumblebee, animals-european-hornet, animals-mosquito |
| sv | animals | normal | vatten | 3 | animals-american-mink, animals-capybara, animals-green-anaconda |
| sv | animals | normal | öken | 3 | animals-dromedary, animals-fennec, animals-rattlesnake |
| sv | clash-royale | easy | dolkar | 3 | clash-royale-goblin-barrel, clash-royale-goblin-gang, clash-royale-goblins |
| sv | clash-royale | easy | flygare | 3 | clash-royale-electro-dragon, clash-royale-minions, clash-royale-spirit-empress |
| sv | clash-royale | easy | krutvapen | 3 | clash-royale-cannon, clash-royale-musketeer, clash-royale-three-musketeers |
| sv | clash-royale | easy | projektil | 3 | clash-royale-fireball, clash-royale-magic-archer, clash-royale-rocket |
| sv | clash-royale | easy | rustning | 3 | clash-royale-mega-knight, clash-royale-mega-minion, clash-royale-pekka |
| sv | clash-royale | easy | ryttare | 3 | clash-royale-dark-prince, clash-royale-prince, clash-royale-ram-rider |
| sv | clash-royale | easy | svärd | 3 | clash-royale-barbarians, clash-royale-battle-healer, clash-royale-elite-barbarians |
| sv | clash-royale | easy | tornförsvar | 3 | clash-royale-cannoneer, clash-royale-dagger-duchess, clash-royale-royal-chef |
| sv | clash-royale | hard | anfall | 3 | clash-royale-dagger-duchess, clash-royale-goblin-drill, clash-royale-skeleton-king |
| sv | clash-royale | hard | avbrott | 3 | clash-royale-inferno-dragon, clash-royale-inferno-tower, clash-royale-lightning |
| sv | clash-royale | hard | avstånd | 3 | clash-royale-bandit, clash-royale-electro-giant, clash-royale-mega-knight |
| sv | clash-royale | hard | nedslag | 3 | clash-royale-arrows, clash-royale-giant-snowball, clash-royale-skeleton-barrel |
| sv | clash-royale | hard | placering | 3 | clash-royale-cannon, clash-royale-fireball, clash-royale-royal-giant |
| sv | clash-royale | normal | angripare | 3 | clash-royale-bomb-tower, clash-royale-electro-giant, clash-royale-goblin-barrel |
| sv | clash-royale | normal | explosion | 3 | clash-royale-fire-spirit, clash-royale-goblin-demolisher, clash-royale-wall-breakers |
| sv | clash-royale | normal | försvar | 3 | clash-royale-cannon, clash-royale-earthquake, clash-royale-tower-princess |
| sv | clash-royale | normal | räckvidd | 3 | clash-royale-pekka, clash-royale-vines, clash-royale-x-bow |
| sv | everyday | easy | löv | 3 | everyday-garden-waste-bag, everyday-leaf-blower, everyday-leaf-rake |
| sv | everyday | hard | förvaring | 3 | everyday-bread-bin, everyday-klappstol, everyday-sideboard |
| sv | everyday | hard | hävstång | 3 | everyday-bottle-opener, everyday-garlic-press, everyday-loppers |
| sv | everyday | normal | grepp | 3 | everyday-rortang, everyday-spetstang, everyday-stand-up-weeder |
| sv | everyday | normal | yta | 3 | everyday-bandslip, everyday-frying-pan, everyday-metallfil |
| sv | film-tv | normal | manhattan | 3 | film-tv-holly-golightly, film-tv-seinfeld, film-tv-when-harry-met-sally |
| sv | film-tv | normal | paraply | 3 | film-tv-mary-poppins, film-tv-overhead-shot, film-tv-singin-in-the-rain |
| sv | food | easy | citrus | 3 | food-lemonade, food-mandarin, food-orange |
| sv | food | easy | grön | 3 | food-lime, food-pear, food-pistachios |
| sv | food | easy | krämigt | 3 | food-macaroni-and-cheese, food-risotto, food-scrambled-eggs |
| sv | food | easy | orange | 3 | food-carrot, food-cheese-puffs, food-sweet-potato |
| sv | food | easy | ris | 3 | food-biryani, food-paella, food-sushi |
| sv | food | hard | lingon | 3 | food-meatballs, food-potato-dumplings, food-raggmunk |
| sv | food | hard | protein | 3 | food-beef-jerky, food-cottage-cheese, food-quinoa |
| sv | food | normal | fyllning | 3 | food-omelette, food-spring-roll, food-tacos |
| sv | food | normal | gryta | 3 | food-beef-bourguignon, food-chili-con-carne, food-goulash |
| sv | food | normal | saftig | 3 | food-pear, food-tomato, food-watermelon |
| sv | food | normal | skal | 3 | food-banana, food-pistachios, food-yellow-onion |
| sv | home-school-clothes | easy | borst | 3 | home-school-clothes-scrubbing-brush, home-school-clothes-shoe-brush, home-school-clothes-toothbrush |
| sv | home-school-clothes | hard | lager | 3 | home-school-clothes-cardigan, home-school-clothes-leggings, home-school-clothes-slip |
| sv | home-school-clothes | normal | resår | 3 | home-school-clothes-boxer-shorts, home-school-clothes-hair-tie, home-school-clothes-swim-trunks |
| sv | minecraft | easy | förtrollning | 3 | minecraft-lapis-lazuli, minecraft-silk-touch, minecraft-swift-sneak |
| sv | minecraft | hard | redstone | 3 | minecraft-breeze, minecraft-hopper, minecraft-sculk-sensor |
| sv | minecraft | normal | glödsten | 3 | minecraft-nether-wastes, minecraft-redstone-lamp, minecraft-respawn-anchor |
| sv | music | easy | stråke | 3 | music-cello, music-viola, music-violin |
| sv | music | easy | tangenter | 3 | music-celesta, music-clavichord, music-piano |
| sv | music | hard | fingrar | 3 | music-castanets, music-pizzicato, music-recorder |
| sv | music | normal | knäppning | 3 | music-castanets, music-harpsichord, music-ukulele |
| sv | music | normal | mässing | 3 | music-saxophone, music-trombone, music-trumpet |
| sv | music | normal | stämmor | 3 | music-arrangement, music-duet, music-harmony |
| sv | nature | hard | kust | 3 | nature-island, nature-strait, nature-tsunami |
| sv | sports | easy | bassäng | 3 | sports-lane-line, sports-swimming, sports-water-polo |
| sv | sports | easy | gymnastik | 3 | sports-balance-beam, sports-parallel-bars, sports-pommel-horse |
| sv | sports | easy | korg | 3 | sports-basketball, sports-slam-dunk, sports-wheelchair-basketball |
| sv | sports | hard | poäng | 3 | sports-assist, sports-taekwondo, sports-tiebreak |
| sv | sports | hard | ring | 3 | sports-boxing-gloves, sports-shot-put, sports-slam-dunk |
| sv | sports | normal | boll | 3 | sports-bandy, sports-football, sports-golf-tee |
| sv | technology | easy | halvledare | 3 | technology-led, technology-photodiode, technology-transistor |
| sv | technology | easy | instruktioner | 3 | technology-command-line, technology-cpu, technology-source-code |
| sv | technology | normal | laddning | 3 | technology-docking-station, technology-power-bank, technology-usb-c |
| sv | travel | easy | japan | 3 | travel-himeji-castle, travel-kyoto, travel-tokyo |
| sv | travel | easy | london | 3 | travel-big-ben, travel-tower-bridge, travel-united-kingdom |
| sv | travel | easy | paris | 3 | travel-arc-de-triomphe, travel-eiffel-tower, travel-france |
| sv | travel | normal | tempel | 3 | travel-angkor-wat, travel-kyoto, travel-thailand |
| sv | vehicles | normal | passagerare | 3 | vehicles-ferry, vehicles-ocean-liner, vehicles-pedal-rickshaw |

## Redaktionell granskning

Källfilerna markerar **2319** begrepp som redaktionellt genomgångna och **0** som osäkra.

Redaktören bedömer om ord och ledtrådar är naturliga på båda språken, om närliggande ord representerar samma begrepp och om paren är jämförbara och går att skilja åt. Bedöm även ledtrådens styrka i små underkategorier.
