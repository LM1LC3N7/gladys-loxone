# Miniserver Loxone

Cette intégration relie Gladys à **votre Miniserver Loxone** (Gen 1 ou Gen 2,
firmware 11.2 ou plus récent) sur votre réseau local et propose ses blocs
dans l'onglet **Découverte** de Gladys : interrupteurs, variateurs,
contrôleurs d'éclairage avec leurs ambiances et leurs circuits, stores et
rideaux, portails, fenêtres motorisées, régulateurs de pièce intelligents,
états virtuels, compteurs et détecteurs de présence. Une fois un appareil
ajouté, ses états suivent le Miniserver en direct, et Gladys le pilote **à
travers le Miniserver**, qui continue de tourner : votre programme Loxone
Config, votre application Loxone et vos automatismes restent tels quels. Non
officiel, sans lien avec Loxone.

> **Version de développement (0.1).** Écrite d'après la documentation de
> l'API Loxone et construite sur la bibliothèque loxone-ts-api, pas encore
> testée sur un vrai Miniserver. Vos retours sont les bienvenus sur le dépôt
> GitHub.

## Mise en route

1. **Créez un utilisateur pour Gladys** dans Loxone Config (Utilisateurs et
   droits), avec un mot de passe, et donnez-lui les pièces et les blocs que
   Gladys peut voir et piloter. Un utilisateur dédié est conseillé : Gladys
   voit exactement ce que cet utilisateur voit, et vous pouvez le révoquer
   sans toucher à votre propre compte. Enregistrez le programme dans le
   Miniserver.
2. Trouvez l'**adresse IP** du Miniserver (Loxone Config, ou votre box
   internet) et donnez-lui une adresse fixe dans votre box.
3. Dans Gladys, ouvrez **Intégrations → Loxone Miniserver → Configuration** et
   saisissez :
   - l'**adresse** : `192.168.1.77`, ou `192.168.1.77:8080` si le Miniserver
     n'écoute pas sur le port 80. `http://` fonctionne avec la Gen 1 et la
     Gen 2 : le Miniserver chiffre lui-même la connexion. Une adresse
     `https://` ne fonctionne qu'avec le nom CloudDNS Loxone d'une Gen 2, pas
     avec son adresse IP (le certificat porte l'adresse CloudDNS) ;
   - le **nom d'utilisateur** et le **mot de passe** de l'utilisateur
     Loxone.
4. Cliquez sur **Tester la connexion** : le Miniserver, sa génération et son
   firmware, le nombre de blocs, les appareils proposés et les types de blocs
   pas encore pris en charge s'affichent sous le bouton.
5. Ouvrez l'onglet **Découverte** et ajoutez les appareils voulus.

## Ce que vous obtenez

| Dans Loxone                                         | Dans Gladys                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Interrupteur, entrée virtuelle interrupteur         | un interrupteur (une lumière dans une catégorie de type « éclairage »)             |
| Minuterie d'escalier / interrupteur multifonction   | marche/arrêt                                                                       |
| Bouton poussoir, entrée virtuelle poussoir, scène   | marche/arrêt : marche envoie une impulsion ; chaque appui arrive dans Gladys       |
| Variateur, variateur EIB                            | une lumière : marche/arrêt, luminosité                                             |
| Contrôleur d'éclairage (LightControllerV2)          | un appareil avec ses ambiances (une liste), marche/arrêt et la luminosité générale |
| … ses circuits d'éclairage                          | une lumière chacun : marche/arrêt, luminosité, couleur pour un circuit RGB         |
| Stores, stores automatiques, rideaux (Jalousie)     | un volet ou un rideau : position (100 % = ouvert), ouvrir, fermer, stop            |
| Stores, portails ou fenêtres centraux               | ouvrir, fermer, stop                                                               |
| Portail, porte de garage                            | sa position, ouvrir, fermer, stop                                                  |
| Fenêtre motorisée                                   | position (100 % = ouverte), ouvrir, fermer, stop                                   |
| Régulateur de pièce intelligent (IRoomControllerV2) | température, consigne, mode (chauffage, froid, auto), préréglage                   |
| État virtuel analogique (InfoOnlyAnalog)            | le capteur que dit son unité : température, humidité, lumière, puissance, énergie… |
| État virtuel numérique (InfoOnlyDigital)            | un capteur d'ouverture (textes « ouvert » / « fermé »), de mouvement, ou un état   |
| État virtuel texte (InfoOnlyText)                   | un texte                                                                           |
| Compteur (Meter)                                    | puissance et énergie ; un compteur bidirectionnel comme compteur réseau            |
| Détecteur de présence                               | un détecteur de mouvement                                                          |

Chaque appareil porte le nom de sa pièce : `Éclairage salon (Salon)`.
Écartés : les blocs affichés seulement dans un schéma système, les blocs sans
visualisation, et les types de blocs pas encore pris en charge (audio,
alarme, interphone, programmateurs… : le test de connexion les nomme). Un bloc
sécurisé (mot de passe de visualisation) ou en lecture seule est proposé en
lecture seule.

### Ambiances

La liste **Ambiance** d'un contrôleur d'éclairage propose ses ambiances par
leur nom, « Tout éteint » en premier. En choisir une la lance (les autres s'éteignent), comme
dans l'application Loxone. Allumer le contrôleur lance « Tout allumé » quand
elle existe, sinon votre première ambiance favorite. Une ambiance créée ou
renommée apparaît dans la liste quelques secondes plus tard.

### Régulateurs de pièce

- **Consigne** : Gladys lance une dérogation manuelle à cette température,
  sans fin, comme le « manuel » de l'application Loxone. Le préréglage
  **Schedule** (programme) met fin à la dérogation : la pièce suit de nouveau son
  programme Loxone.
- **Préréglage** : Économie, Confort, Protection du bâtiment (avec les noms
  de votre configuration Loxone) lancent une dérogation de ce mode.
- **Mode** : chauffage seul, froid seul, ou les deux (auto). Le choix
  automatique ou manuel de Loxone est conservé. Éteindre un régulateur se
  fait dans Loxone.

## Bon à savoir

- **Temps réel** : le Miniserver pousse chaque changement par son WebSocket ;
  Gladys envoie ce qui a changé.
- **Mesures** : un compteur remonte sa puissance toutes les quelques
  secondes. Gladys garde la dernière mesure toutes les **Intervalle minimum
  entre deux mesures d'un capteur** (10 s par défaut) ; interrupteurs,
  lumières, stores, boutons et présence ne sont jamais retardés.
- **Changements dans Loxone Config** : après l'enregistrement d'un nouveau
  programme, le Miniserver redémarre et Gladys relit sa structure à la
  reconnexion (et la vérifie toutes les 10 minutes) ; cliquez sur **Scanner**
  dans Découverte pour forcer.
- **Connexions** : le Miniserver accepte au plus 31 clients en temps réel
  (applications, intégrations). Gladys en utilise un, et un de plus pendant
  quelques secondes lors d'un test de connexion.
- Le Miniserver **bloque une adresse** après plusieurs échecs de connexion :
  après une erreur de mot de passe, Gladys ne réessaie que toutes les
  5 minutes.
- **Remote Connect** (un numéro de série au lieu d'une adresse) n'est pas
  encore pris en charge : Gladys et le Miniserver doivent être sur le même
  réseau.

## Dépannage

- **« a refusé le nom d'utilisateur ou le mot de passe »** : saisissez-les à
  nouveau ; essayez-les dans l'application Loxone.
- **« bloque cette adresse »** : attendez quelques minutes, vérifiez le mot de
  passe.
- **« injoignable »** : utilisez l'adresse IP du Miniserver sur le réseau
  local (pas `localhost`), avec son port s'il n'est pas 80, et vérifiez que
  la machine Gladys le joint.
- **« certificat refusé »** : utilisez `http://` et l'adresse IP.
- **« plus de connexion libre »** : fermez une application ou une autre
  intégration connectée au Miniserver.
- **Un bloc manque** : l'utilisateur Loxone le voit-il (sa pièce, ses
  droits) ? Est-il affiché dans une liste de pièce (pas seulement dans un
  schéma système) ? Son type est-il pris en charge (cliquez sur **Tester la
  connexion**) ?
- **Une commande échoue avec « may not control this block »** : donnez à
  l'utilisateur Loxone le droit de le piloter, ou le bloc est protégé par un
  mot de passe de visualisation (pas encore pris en charge).
