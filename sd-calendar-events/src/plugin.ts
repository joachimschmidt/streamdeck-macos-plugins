import streamDeck from "@elgato/streamdeck";
import { CalendarAction } from "./calendar-action";

streamDeck.actions.registerAction(new CalendarAction());
streamDeck.connect();
