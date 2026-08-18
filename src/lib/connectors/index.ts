// Side-effect: registering all connectors when this module is imported.
import './google-ads'
import './shopify'

export { runConnectorSync, getConnector, listConnectorTypes } from './framework'
