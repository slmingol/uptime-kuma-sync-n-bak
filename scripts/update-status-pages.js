#!/usr/bin/env node
/**
 * One-time script to update status pages with missing monitors.
 * Updates primary instance; run make sync afterwards to propagate to secondary.
 * Usage: node scripts/update-status-pages.js <instance-name>
 */

const io = require('socket.io-client');
const fs = require('fs');

const configFile = process.env.CONFIG_FILE || './uptime-kuma-config.json';
const instanceName = process.argv[2] || 'primary';

const fileConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const instance = fileConfig.instances[instanceName];
if (!instance) {
  console.error(`Instance "${instanceName}" not found in config`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Desired status page state
// ---------------------------------------------------------------------------

const STATUS_PAGES = {
  statuspageslug: {
    groups: [
      {
        name: 'Security Cameras',
        monitors: [60, 56, 53, 57, 58, 52, 54, 55, 59]
      },
      {
        name: 'Networking',
        monitors: [
          63,
          39, 40, 91,                          // APs
          13, 12, 214, 93,                     // NET checks (added ifconfig.io)
          89, 161, 1, 162,                     // routers + Qotom boxes
          27, 47,                              // tplink
          2,                                   // unifi
          45, 44,                              // pikvm
          99, 185, 50, 42, 41,                 // switches (added uswpm-16)
          88, 215, 216, 217                    // Newt #1-4
        ]
      },
      {
        name: 'Networking [EXT]',
        monitors: [133, 135, 136, 134]
      },
      {
        name: 'Meshtastic',
        monitors: [181, 180, 188, 195]
      },
      {
        name: 'Meshtastic [EXT]',
        monitors: [184, 183, 189, 197]
      },
      {
        name: 'Misc',
        monitors: [37, 26, 155, 156, 157]
      },
      {
        name: 'HVs & Containers Mgmt',
        monitors: [100, 22, 24, 137, 169, 69, 191, 250, 94, 95]
      },
      {
        name: 'HVs & Container Mgmt [EXT]',
        monitors: [127, 128, 190, 251, 131, 132]
      },
      {
        name: 'k8s/k3s',
        monitors: [66, 16, 17, 18, 19, 20, 21, 31]
      },
      {
        name: 'Gaming',
        monitors: [61, 38, 25, 160]
      },
      {
        name: 'Games',
        monitors: [
          202,
          227,                                 // Jamerica landing page
          218,                                 // Connections (internal)
          220,                                 // Contexto
          237,                                 // Crossword
          229,                                 // animalist
          233,                                 // cat-limber
          219,                                 // Strands
          231,                                 // JitterboxRocks
          203, 204, 205                        // Worlde variants
        ]
      },
      {
        name: 'Games [EXT]',
        monitors: [
          206,
          230,                                 // Animalist EXT
          226,                                 // Bandle EXT
          223,                                 // Connections EXT
          225,                                 // Contexto EXT
          238,                                 // Crossword EXT
          234,                                 // cat-climber EXT
          224,                                 // Strands EXT
          232,                                 // JitterboxRocks EXT
          207, 208, 209                        // Worlde EXT variants
        ]
      },
      {
        name: 'Entertainment',
        monitors: [
          65,
          29, 30,                              // TVs
          78, 87,                              // airsonic, audiobookshelf
          34, 192, 97, 193,                    // jellyfinbr1-4
          172, 163,                            // HDHomeRun IPTV, hdhr-hdtv-01
          75, 86, 73, 71, 74,                  // seerr, jellystat, prowlarr, radarr, sonarr
          151, 152, 175, 254, 246,              // makemkv, arm-ripper, cleanuparr, livrarr, pinchflat
          85, 82, 84,                          // flaresolverr, flare-bypasser, tor-socks-proxy
          104, 165                             // pi-vpn, pi-tor-01
        ]
      },
      {
        name: 'Entertainment [EXT]',
        monitors: [
          118,
          119, 120,                            // airsonic, audiobookshelf EXT
          138, 121, 199,                       // jellyfinbr2/3/4 EXT
          164,                                 // hdhr-hdtv-01 EXT
          122, 123, 124, 125, 126,             // seerr, jellystat, prowlarr, radarr, sonarr EXT
          176, 255, 247,                       // cleanuparr, livrarr, pinchflat EXT
          4, 166                               // pi-vpn, pi-tor-01 EXT
        ]
      },
      {
        name: 'DNS',
        monitors: [62, 14, 15, 3, 5, 7, 32]
      },
      {
        name: 'DNS [EXT]',
        monitors: [113, 114, 115, 116, 198]
      },
      {
        name: 'Core Svcs - Infrastructure',
        monitors: [
          64,                                  // group monitor
          8,                                   // Printer
          36, 103,                             // NAS
          28,                                  // Phone
          147, 148,                            // UPS
          186,                                 // birdnet-pi
          46, 11,                              // home2, SimpleLogin
          145, 211, 264                        // Netbox, Nexus, hermes
        ]
      },
      {
        name: 'Core Svcs - Infrastructure [EXT]',
        monitors: [
          101,                                 // group monitor
          102, 80,                             // NAS EXT
          187,                                 // birdnet-pi EXT
          107,                                 // home2 EXT
          146, 213, 265                        // Netbox, Nexus, hermes EXT
        ]
      },
      {
        name: 'Core Svcs - Apps',
        monitors: [
          48, 49, 67, 68, 79,                  // Homepage, IT Tools, Pingvin, OpenWebUI, Snappass
          139, 143, 153, 158,                  // guacamole, Vikunja, FreshRSS, eigenfocus
          177, 200, 210, 235, 243,             // httpbin, Stirling-PDF, pairdrop, SearXNG, SignalHub
          245, 249, 256, 258, 261, 262         // excalidraw, vaultwarden, HomeBox, linkding, karakeep, bentopdf
        ]
      },
      {
        name: 'Core Svcs - Apps [EXT]',
        monitors: [
          108, 109, 111, 110, 112,             // Homepage, IT Tools, Pingvin, OpenWebUI, Snappass EXT
          140, 144, 154, 159,                  // guacamole, Vikunja, FreshRSS, eigenfocus EXT
          178, 201, 212, 236, 244,             // httpbin, Stirling-PDF, pairdrop, SearXNG, SignalHub EXT
          248, 252, 257, 259, 260, 263         // excalidraw, vaultwarden, HomeBox, linkding, karakeep, bentopdf EXT
        ]
      },
      {
        name: 'FlightAware',
        monitors: [90, 96, 141, 149, 167, 168]
      },
      {
        name: 'FlightAware [EXT]',
        monitors: [105, 106, 142, 150, 173, 174]
      }
    ]
  },

  tldrsvcs: {
    groups: [
      {
        name: 'Services',
        monitors: [64, 62, 65, 61, 202, 100, 66, 63, 60]
      }
    ]
  },

  tldrsvcsext: {
    groups: [
      {
        name: 'Services',
        monitors: [101, 113, 118, 206, 127, 133]
      }
    ]
  }
};

// ---------------------------------------------------------------------------

async function connect(url, username, password) {
  return new Promise((resolve, reject) => {
    const socket = io(url, { transports: ['polling', 'websocket'], reconnection: false });
    socket._statusPageList = [];
    socket.on('statusPageList', (data) => {
      socket._statusPageList = Object.values(data || {});
    });
    socket.on('connect', () => {
      socket.emit('login', { username, password, token: '' }, (res) => {
        if (res.ok) {
          setTimeout(() => resolve(socket), 500);
        } else {
          reject(new Error(`Login failed: ${res.msg}`));
        }
      });
    });
    socket.on('connect_error', (err) => reject(new Error(err.message)));
  });
}

async function getPageConfig(baseUrl, slug) {
  const res = await fetch(`${baseUrl}/api/status-page/${slug}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function saveStatusPage(socket, slug, config, publicGroupList) {
  return new Promise((resolve, reject) => {
    socket.emit('saveStatusPage', slug, config, '', publicGroupList, (res) => {
      if (res.ok) resolve(res);
      else reject(new Error(res.msg));
    });
  });
}

(async () => {
  console.log(`Connecting to ${instanceName} (${instance.url})...`);
  const socket = await connect(instance.url, instance.username, instance.password);
  console.log('Connected.\n');

  for (const [slug, desired] of Object.entries(STATUS_PAGES)) {
    console.log(`--- ${slug} ---`);

    // Fetch current page config to preserve title/theme/etc.
    let pageData;
    try {
      pageData = await getPageConfig(instance.url, slug);
    } catch (err) {
      console.error(`  Could not fetch page config: ${err.message}`);
      continue;
    }

    const { config } = pageData;

    const analyticsId = config.analyticsId || config.googleAnalyticsId || null;
    const analyticsType = config.analyticsType || (analyticsId ? 'google' : null);

    const cleanConfig = {
      slug: config.slug,
      title: config.title,
      description: config.description || '',
      theme: config.theme || 'light',
      published: config.published !== false,
      showTags: config.showTags || false,
      domainNameList: config.domainNameList || [],
      customCSS: config.customCSS || '',
      footerText: config.footerText || null,
      showPoweredBy: config.showPoweredBy !== false,
      icon: config.icon || '/icon.svg',
      analyticsType,
      analyticsId: analyticsId || null,
      analyticsScriptUrl: config.analyticsScriptUrl || null
    };

    const publicGroupList = desired.groups.map((group, i) => ({
      name: group.name,
      weight: i + 1,
      monitorList: group.monitors.map(id => ({ id }))
    }));

    try {
      await saveStatusPage(socket, slug, cleanConfig, publicGroupList);
      const total = desired.groups.reduce((s, g) => s + g.monitors.length, 0);
      console.log(`  ✓ saved — ${desired.groups.length} groups, ${total} monitors`);
    } catch (err) {
      console.error(`  ✗ failed: ${err.message}`);
    }
  }

  socket.disconnect();
  console.log('\nDone. Run make sync to propagate changes to secondary.');
})().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
