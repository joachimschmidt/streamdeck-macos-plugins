import streamDeck from "@elgato/streamdeck";
import { BtConnectAction } from "./bt-connect-action";

streamDeck.actions.registerAction(new BtConnectAction());
streamDeck.connect();
