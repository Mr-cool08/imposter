# Innehållsrapport

Innehållsversion `38448adb1325ae16f62e592d4e7fe53ec326b57ca645ea8ecc90f0403faebb7a`.

**Uppfyller innehållsgränserna.** Gränserna är 2000 spelbara begrepp och 100 användbara ordpar, spelbart innehåll i obligatoriska och övriga listade kategorier och inga strukturella fel.

Katalogen innehåller **2319 unika begrepp** och **255 unika ordpar** efter automatisk avdubblering.

## Spelbart innehåll

Tabellen räknar alla kunskapsnivåer. Ett par räknas i en kategori när båda orden ingår där. Par mellan kategorier ingår i totalen och kan användas när båda kategorierna är valda.

| Kategori | Ord | Ledtrådar | Par |
| --- | ---: | ---: | ---: |
| Minecraft (`minecraft`) | 176 | 528 | 14 |
| Clash Royale (`clash-royale`) | 122 | 366 | 12 |
| Spel (`games`) | 128 | 384 | 10 |
| Vardagsföremål (`everyday`) | 191 | 573 | 25 |
| Teknologi (`technology`) | 190 | 570 | 24 |
| Mat och dryck (`food`) | 205 | 615 | 35 |
| Djur (`animals`) | 199 | 597 | 33 |
| Natur (`nature`) | 132 | 396 | 10 |
| Sport och fritid (`sports`) | 137 | 411 | 10 |
| Fordon (`vehicles`) | 125 | 375 | 8 |
| Film och serier (`film-tv`) | 128 | 384 | 19 |
| Musik (`music`) | 130 | 390 | 11 |
| Platser och resor (`travel`) | 137 | 411 | 11 |
| Yrken (`occupations`) | 108 | 324 | 13 |
| Hem, skola och kläder (`home-school-clothes`) | 211 | 633 | 20 |
| Mellan kategorier | — | — | 0 |
| **Totalt** | 2319 | 6957 | 255 |

På nivån Välkända finns **484** begrepp, på Mellannivå **1519** och på Expert **316**.

Med standardnivån `familiar` och alla kategorier valda finns 484 begrepp och 54 par.

## Automatisk validering

Valideringen kontrollerar JSON, obligatoriska fält, unika identifierare, namn, parreferenser och att varje ledtråd består av ett ord. Övriga kontroller av ledtrådstext hittar mönster att gå igenom manuellt.

- Strukturella fel **0**
- Dublett- och aliashändelser **0**
- Saknade obligatoriska fält **0**
- Ledtrådar som återkommer för minst 3 begrepp i samma kategori på samma ledtrådsnivå **95**
- Träffar på generiska ledtrådar **0**
- Ledtrådar med ordet eller ett angivet alias **0**

### Återanvända ledtrådar

| Kategori | Ledtrådsnivå | Normaliserad ledtråd | Antal begrepp | Ord-ID |
| --- | --- | --- | ---: | --- |
| minecraft | easy | nether | 8 | minecraft-ancient-debris, minecraft-blaze, minecraft-crimson-forest, minecraft-ghast-tear, minecraft-glowstone, minecraft-hoglin, minecraft-magma-cube, minecraft-respawn-anchor |
| music | hard | orkester | 6 | music-flute, music-oboe, music-opera, music-overture, music-timpani, music-tuba |
| animals | normal | flock | 5 | animals-african-wild-dog, animals-american-bison, animals-baboon, animals-grey-wolf, animals-sheep |
| clash-royale | hard | försvar | 5 | clash-royale-bomb-tower, clash-royale-goblin-hut, clash-royale-hog-rider, clash-royale-knight, clash-royale-tombstone |
| everyday | normal | jord | 5 | everyday-bow-rake, everyday-garden-hoe, everyday-grow-bag, everyday-raised-bed, everyday-wheelbarrow |
| film-tv | easy | fbi | 5 | film-tv-clarice-starling, film-tv-dana-scully, film-tv-fox-mulder, film-tv-the-x-files, film-tv-twin-peaks |
| games | easy | hyrule | 5 | games-legend-of-zelda-breath-of-the-wild, games-link, games-master-sword, games-princess-zelda, games-triforce |
| animals | easy | fläckar | 4 | animals-african-wild-dog, animals-jaguar, animals-leopard, animals-leopard-slug |
| animals | easy | taggar | 4 | animals-echidna, animals-hedgehog, animals-north-american-porcupine, animals-sea-urchin |
| animals | normal | gift | 4 | animals-adder, animals-black-widow, animals-king-cobra, animals-komodo-dragon |
| clash-royale | easy | benkrigare | 4 | clash-royale-graveyard, clash-royale-guards, clash-royale-skeleton-king, clash-royale-tombstone |
| clash-royale | easy | hoppare | 4 | clash-royale-electro-spirit, clash-royale-fire-spirit, clash-royale-heal-spirit, clash-royale-ice-spirit |
| clash-royale | hard | räckvidd | 4 | clash-royale-flying-machine, clash-royale-hunter, clash-royale-princess, clash-royale-spear-goblins |
| clash-royale | normal | laddning | 4 | clash-royale-inferno-dragon, clash-royale-inferno-tower, clash-royale-sparky, clash-royale-zap |
| everyday | hard | tänder | 4 | everyday-bow-rake, everyday-garden-fork, everyday-hedge-trimmer, everyday-metallsag |
| food | normal | buljong | 4 | food-onion-soup, food-pho, food-ramen, food-risotto |
| food | normal | kryddor | 4 | food-biryani, food-dal, food-gingerbread-cookie, food-glogg |
| games | easy | pokémon | 4 | games-eevee, games-mewtwo, games-poke-ball, games-pokedex |
| home-school-clothes | hard | veck | 4 | home-school-clothes-garment-steamer, home-school-clothes-kilt, home-school-clothes-sari, home-school-clothes-shoe-tree |
| home-school-clothes | normal | vinter | 4 | home-school-clothes-beanie, home-school-clothes-down-jacket, home-school-clothes-mittens, home-school-clothes-scarf |
| minecraft | normal | nether | 4 | minecraft-bedrock, minecraft-lodestone, minecraft-netherite-ingot, minecraft-ruined-portal |
| technology | easy | trådlöst | 4 | technology-access-point, technology-bluetooth, technology-ssid, technology-wifi |
| animals | easy | horn | 3 | animals-moose, animals-rhinoceros, animals-water-buffalo |
| animals | easy | ränder | 3 | animals-perch, animals-tiger, animals-zebra |
| animals | easy | vit | 3 | animals-beluga, animals-mute-swan, animals-snowy-owl |
| animals | hard | klättrare | 3 | animals-red-panda, animals-ring-tailed-lemur, animals-virginia-opossum |
| animals | hard | nattaktiv | 3 | animals-badger, animals-fennec, animals-hamster |
| animals | hard | skymning | 3 | animals-armadillo, animals-field-cricket, animals-golden-jackal |
| animals | normal | pung | 3 | animals-koala, animals-virginia-opossum, animals-wombat |
| animals | normal | savann | 3 | animals-blue-wildebeest, animals-giraffe, animals-zebra |
| animals | normal | surr | 3 | animals-bumblebee, animals-european-hornet, animals-mosquito |
| animals | normal | vatten | 3 | animals-american-mink, animals-capybara, animals-green-anaconda |
| animals | normal | öken | 3 | animals-dromedary, animals-fennec, animals-rattlesnake |
| clash-royale | easy | dolkar | 3 | clash-royale-goblin-barrel, clash-royale-goblin-gang, clash-royale-goblins |
| clash-royale | easy | flygare | 3 | clash-royale-electro-dragon, clash-royale-minions, clash-royale-spirit-empress |
| clash-royale | easy | krutvapen | 3 | clash-royale-cannon, clash-royale-musketeer, clash-royale-three-musketeers |
| clash-royale | easy | projektil | 3 | clash-royale-fireball, clash-royale-magic-archer, clash-royale-rocket |
| clash-royale | easy | rustning | 3 | clash-royale-mega-knight, clash-royale-mega-minion, clash-royale-pekka |
| clash-royale | easy | ryttare | 3 | clash-royale-dark-prince, clash-royale-prince, clash-royale-ram-rider |
| clash-royale | easy | svärd | 3 | clash-royale-barbarians, clash-royale-battle-healer, clash-royale-elite-barbarians |
| clash-royale | easy | tornförsvar | 3 | clash-royale-cannoneer, clash-royale-dagger-duchess, clash-royale-royal-chef |
| clash-royale | hard | anfall | 3 | clash-royale-dagger-duchess, clash-royale-goblin-drill, clash-royale-skeleton-king |
| clash-royale | hard | avbrott | 3 | clash-royale-inferno-dragon, clash-royale-inferno-tower, clash-royale-lightning |
| clash-royale | hard | avstånd | 3 | clash-royale-bandit, clash-royale-electro-giant, clash-royale-mega-knight |
| clash-royale | hard | nedslag | 3 | clash-royale-arrows, clash-royale-giant-snowball, clash-royale-skeleton-barrel |
| clash-royale | hard | placering | 3 | clash-royale-cannon, clash-royale-fireball, clash-royale-royal-giant |
| clash-royale | normal | angripare | 3 | clash-royale-bomb-tower, clash-royale-electro-giant, clash-royale-goblin-barrel |
| clash-royale | normal | explosion | 3 | clash-royale-fire-spirit, clash-royale-goblin-demolisher, clash-royale-wall-breakers |
| clash-royale | normal | försvar | 3 | clash-royale-cannon, clash-royale-earthquake, clash-royale-tower-princess |
| clash-royale | normal | räckvidd | 3 | clash-royale-pekka, clash-royale-vines, clash-royale-x-bow |
| everyday | easy | löv | 3 | everyday-garden-waste-bag, everyday-leaf-blower, everyday-leaf-rake |
| everyday | hard | förvaring | 3 | everyday-bread-bin, everyday-klappstol, everyday-sideboard |
| everyday | hard | hävstång | 3 | everyday-bottle-opener, everyday-garlic-press, everyday-loppers |
| everyday | normal | grepp | 3 | everyday-rortang, everyday-spetstang, everyday-stand-up-weeder |
| everyday | normal | yta | 3 | everyday-bandslip, everyday-frying-pan, everyday-metallfil |
| film-tv | normal | manhattan | 3 | film-tv-holly-golightly, film-tv-seinfeld, film-tv-when-harry-met-sally |
| film-tv | normal | paraply | 3 | film-tv-mary-poppins, film-tv-overhead-shot, film-tv-singin-in-the-rain |
| food | easy | citrus | 3 | food-lemonade, food-mandarin, food-orange |
| food | easy | grön | 3 | food-lime, food-pear, food-pistachios |
| food | easy | krämigt | 3 | food-macaroni-and-cheese, food-risotto, food-scrambled-eggs |
| food | easy | orange | 3 | food-carrot, food-cheese-puffs, food-sweet-potato |
| food | easy | ris | 3 | food-biryani, food-paella, food-sushi |
| food | hard | lingon | 3 | food-meatballs, food-potato-dumplings, food-raggmunk |
| food | hard | protein | 3 | food-beef-jerky, food-cottage-cheese, food-quinoa |
| food | normal | fyllning | 3 | food-omelette, food-spring-roll, food-tacos |
| food | normal | gryta | 3 | food-beef-bourguignon, food-chili-con-carne, food-goulash |
| food | normal | saftig | 3 | food-pear, food-tomato, food-watermelon |
| food | normal | skal | 3 | food-banana, food-pistachios, food-yellow-onion |
| home-school-clothes | easy | borst | 3 | home-school-clothes-scrubbing-brush, home-school-clothes-shoe-brush, home-school-clothes-toothbrush |
| home-school-clothes | hard | lager | 3 | home-school-clothes-cardigan, home-school-clothes-leggings, home-school-clothes-slip |
| home-school-clothes | normal | resår | 3 | home-school-clothes-boxer-shorts, home-school-clothes-hair-tie, home-school-clothes-swim-trunks |
| minecraft | easy | förtrollning | 3 | minecraft-lapis-lazuli, minecraft-silk-touch, minecraft-swift-sneak |
| minecraft | hard | redstone | 3 | minecraft-breeze, minecraft-hopper, minecraft-sculk-sensor |
| minecraft | normal | glödsten | 3 | minecraft-nether-wastes, minecraft-redstone-lamp, minecraft-respawn-anchor |
| music | easy | stråke | 3 | music-cello, music-viola, music-violin |
| music | easy | tangenter | 3 | music-celesta, music-clavichord, music-piano |
| music | hard | fingrar | 3 | music-castanets, music-pizzicato, music-recorder |
| music | normal | knäppning | 3 | music-castanets, music-harpsichord, music-ukulele |
| music | normal | mässing | 3 | music-saxophone, music-trombone, music-trumpet |
| music | normal | stämmor | 3 | music-arrangement, music-duet, music-harmony |
| nature | hard | kust | 3 | nature-island, nature-strait, nature-tsunami |
| sports | easy | bassäng | 3 | sports-lane-line, sports-swimming, sports-water-polo |
| sports | easy | gymnastik | 3 | sports-balance-beam, sports-parallel-bars, sports-pommel-horse |
| sports | easy | korg | 3 | sports-basketball, sports-slam-dunk, sports-wheelchair-basketball |
| sports | hard | poäng | 3 | sports-assist, sports-taekwondo, sports-tiebreak |
| sports | hard | ring | 3 | sports-boxing-gloves, sports-shot-put, sports-slam-dunk |
| sports | normal | boll | 3 | sports-bandy, sports-football, sports-golf-tee |
| technology | easy | halvledare | 3 | technology-led, technology-photodiode, technology-transistor |
| technology | easy | instruktioner | 3 | technology-command-line, technology-cpu, technology-source-code |
| technology | normal | laddning | 3 | technology-docking-station, technology-power-bank, technology-usb-c |
| travel | easy | japan | 3 | travel-himeji-castle, travel-kyoto, travel-tokyo |
| travel | easy | london | 3 | travel-big-ben, travel-tower-bridge, travel-united-kingdom |
| travel | easy | paris | 3 | travel-arc-de-triomphe, travel-eiffel-tower, travel-france |
| travel | normal | tempel | 3 | travel-angkor-wat, travel-kyoto, travel-thailand |
| vehicles | normal | passagerare | 3 | vehicles-ferry, vehicles-ocean-liner, vehicles-pedal-rickshaw |

## Redaktionell granskning

Källfilerna markerar **2319** begrepp som redaktionellt genomgångna och **0** som osäkra.

Redaktören bedömer om ord och ledtrådar är naturliga på svenska, om närliggande ord representerar samma begrepp och om paren är jämförbara och går att skilja åt. Bedöm även ledtrådens styrka i små underkategorier.
