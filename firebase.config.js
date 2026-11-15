/* Firebase, for the failure wall.
 *
 * Only these two values are used: net/wall.js talks to Firestore over REST
 * rather than the Firebase SDK, so the rest of the console snippet
 * (authDomain, appId, initializeApp...) is not needed here.
 *
 * Neither is a secret - they ship in every Firebase web app and are visible
 * in the bundle. What stops a stranger writing nonsense is the Firestore
 * rules, not hiding these. See README.
 */
export const CONFIG = {
  apiKey: 'AIzaSyCML41S4huSnAPDwxRt6c4U4iUSZj7IkIk',
  projectId: 'dave-portfolio3d',
};
