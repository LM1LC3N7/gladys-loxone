// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, buttons, badges), in English and
// French. Never put the password or a token in one of them.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** ' "Maison"' after "Miniserver", nothing when the Miniserver has no name. */
const nameOf = (ms) => (ms?.name ? ` "${ms.name}"` : '');

/** Why the Miniserver is unreachable, with the hint that fits. */
function unreachable(err) {
  const reason = err?.message ?? 'unknown error';
  return {
    en: `The Loxone Miniserver is unreachable: ${reason}. Use its IP address on your local network (not localhost), with the port when it is not 80. Retrying in a few seconds.`,
    fr: `Le Miniserver Loxone est injoignable : ${reason}. Utilisez son adresse IP sur le réseau local (pas localhost), avec le port s'il n'est pas 80. Nouvel essai dans quelques secondes.`,
  };
}

export const T = {
  notConfigured: {
    en: 'Type the address of your Miniserver (for example 192.168.1.77), the Loxone user name and its password in the configuration.',
    fr: "Saisissez l'adresse de votre Miniserver (par exemple 192.168.1.77), le nom d'utilisateur Loxone et son mot de passe dans la configuration.",
  },
  noUser: {
    en: 'Type the Loxone user name in the configuration (a user of the Miniserver; a dedicated one is advised).',
    fr: "Saisissez le nom d'utilisateur Loxone dans la configuration (un utilisateur du Miniserver ; un utilisateur dédié est conseillé).",
  },
  noPassword: {
    en: 'Type the password of the Loxone user in the configuration.',
    fr: "Saisissez le mot de passe de l'utilisateur Loxone dans la configuration.",
  },
  badAddress(reason) {
    if (reason === 'credentials') {
      return {
        en: 'No user name or password in the address: they have their own fields.',
        fr: "Pas d'utilisateur ni de mot de passe dans l'adresse : ils ont leurs propres champs.",
      };
    }
    if (reason === 'serial') {
      return {
        en: 'A serial number (Loxone Remote Connect) is not supported yet: type the IP address of the Miniserver on your local network.',
        fr: "Un numéro de série (Loxone Remote Connect) n'est pas encore pris en charge : saisissez l'adresse IP du Miniserver sur votre réseau local.",
      };
    }
    return {
      en: 'The address of the Miniserver is not valid: use 192.168.1.77, 192.168.1.77:8080 or http://192.168.1.77.',
      fr: "L'adresse du Miniserver n'est pas valide : utilisez 192.168.1.77, 192.168.1.77:8080 ou http://192.168.1.77.",
    };
  },
  /** The status of a configuration error (see normalizeConfig). */
  configError(error) {
    if (error === 'empty') {
      return T.notConfigured;
    }
    if (error === 'no-user') {
      return T.noUser;
    }
    return error === 'no-password' ? T.noPassword : T.badAddress(error);
  },
  connecting: {
    en: 'Connecting to the Loxone Miniserver…',
    fr: 'Connexion au Miniserver Loxone…',
  },
  connected: (ms, info, devices) => ({
    en: `Connected to the Miniserver${nameOf(ms)} (firmware ${info?.version || '?'}): ${plural(devices, 'device', 'devices')} in Discovery.`,
    fr: `Connecté au Miniserver${nameOf(ms)} (firmware ${info?.version || '?'}) : ${plural(devices, 'appareil', 'appareils')} dans Découverte.`,
  }),
  /** The status of a failed connection (a LoxoneError). */
  failure(err) {
    switch (err?.kind) {
      case 'auth':
        return {
          en: 'The Miniserver refused the user name or the password: type them again in the configuration (a user of the Miniserver; a dedicated one is advised). Gladys retries every 5 minutes.',
          fr: "Le Miniserver a refusé le nom d'utilisateur ou le mot de passe : saisissez-les à nouveau dans la configuration (un utilisateur du Miniserver ; un utilisateur dédié est conseillé). Gladys réessaie toutes les 5 minutes.",
        };
      case 'blocked':
        return {
          en: 'The Miniserver blocks this address after too many failed logins: check the password, Gladys retries every 5 minutes.',
          fr: "Le Miniserver bloque cette adresse après trop d'échecs de connexion : vérifiez le mot de passe, Gladys réessaie toutes les 5 minutes.",
        };
      case 'disabled':
        return {
          en: 'This Loxone user is disabled or expired: enable it in the user management of Loxone Config.',
          fr: 'Cet utilisateur Loxone est désactivé ou expiré : réactivez-le dans la gestion des utilisateurs de Loxone Config.',
        };
      case 'busy':
        return {
          en: 'The Miniserver has no free connection for live updates (31 at most): close another app or integration, Gladys retries.',
          fr: "Le Miniserver n'a plus de connexion libre pour le temps réel (31 au plus) : fermez une autre application ou intégration, Gladys réessaie.",
        };
      case 'firmware':
        return {
          en: `The firmware of the Miniserver is too old (${err.message}): version 11.2 or later is needed, update it with Loxone Config.`,
          fr: `Le firmware du Miniserver est trop ancien (${err.message}) : la version 11.2 ou plus récente est nécessaire, mettez-le à jour avec Loxone Config.`,
        };
      case 'certificate':
        return {
          en: 'The HTTPS certificate of the Miniserver is refused (it is made for its Loxone CloudDNS name, not its IP address): use http:// and its IP address on your local network.',
          fr: 'Le certificat HTTPS du Miniserver est refusé (il est fait pour son nom Loxone CloudDNS, pas pour son adresse IP) : utilisez http:// et son adresse IP sur le réseau local.',
        };
      case 'redirect':
        return {
          en: `The Miniserver ${err.message}: type that address in the configuration.`,
          fr: `Le Miniserver redirige ailleurs (${err.message}) : saisissez cette adresse dans la configuration.`,
        };
      case 'rebooting':
        return {
          en: 'The Miniserver is restarting: Gladys retries in a few seconds.',
          fr: 'Le Miniserver redémarre : Gladys réessaie dans quelques secondes.',
        };
      case 'format':
      case 'http':
        return {
          en: `No Loxone Miniserver at this address (${err.message}): type the IP address of the Miniserver, with its port when it is not 80.`,
          fr: `Pas de Miniserver Loxone à cette adresse (${err.message}) : saisissez l'adresse IP du Miniserver, avec son port s'il n'est pas 80.`,
        };
      default:
        return unreachable(err);
    }
  },
  /** Transport badge of a block whose Loxone device is offline (≤ 200 characters). */
  offline: {
    en: 'Loxone reports the device of this block as offline (Air or Tree): battery, range or power.',
    fr: "Loxone signale l'appareil de ce bloc comme hors ligne (Air ou Tree) : pile, portée ou alimentation.",
  },
  test: {
    ok({ ms, info, devices, controls, unsupported, empty, hidden }) {
      const listed = unsupported.map(([type, n]) => `${type} ×${n}`).join(', ');
      const left = unsupported.reduce((sum, [, n]) => sum + n, 0);
      const gen = info.https ? 'Gen 2' : 'Gen 1';
      return {
        en:
          `Connection OK, Miniserver${nameOf(ms)} ${gen} (firmware ${info.version}, project "${ms.project || '?'}"): ` +
          `${plural(controls, 'block', 'blocks')}, ${plural(devices, 'device', 'devices')} offered in Discovery.` +
          (left > 0 ? ` Not supported yet: ${listed}.` : '') +
          (empty + hidden > 0 ? ` ${empty + hidden} left out (nothing to offer or hidden).` : ''),
        fr:
          `Connexion OK, Miniserver${nameOf(ms)} ${gen} (firmware ${info.version}, projet « ${ms.project || '?'} ») : ` +
          `${plural(controls, 'bloc', 'blocs')}, ${plural(devices, 'appareil proposé', 'appareils proposés')} dans Découverte.` +
          (left > 0 ? ` Pas encore pris en charge : ${listed}.` : '') +
          (empty + hidden > 0 ? ` ${empty + hidden} écartés (rien à proposer ou masqués).` : ''),
      };
    },
  },
  notConnected: {
    en: 'The Loxone Miniserver is not connected',
    fr: "Le Miniserver Loxone n'est pas connecté",
  },
};
