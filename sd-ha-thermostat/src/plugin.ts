import streamDeck from "@elgato/streamdeck";
import { ThermostatAction } from "./thermostat-action";

streamDeck.actions.registerAction(new ThermostatAction());
streamDeck.connect();
