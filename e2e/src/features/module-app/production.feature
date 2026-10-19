@module-app-production
Feature: Module App production acceptance
  Production enablement must preserve authorization, durable state, and verified payment truth.

  Scenario: Launch a preinstalled executable personal application
    Given the Module App production gate environment is configured
    When I open the configured Module App detail page
    Then the Module App detail should render
    When I open the configured Module App runtime page
    Then the Module App runtime should render without a launch error

  Scenario: Open the authenticated developer console
    Given the Module App production gate environment is configured
    When I open the Module App developer console
    Then the Module App developer console should render

  Scenario: Open the authenticated developer console on a phone viewport
    Given the Module App production gate environment is configured
    When I open the Module App developer console on a phone viewport
    Then the Module App developer console should render without horizontal overflow

  Scenario: Observe durable executable action and workflow progress
    Given the Module App production gate environment is configured
    When I open the configured Module App runtime page with its workflow run
    Then persisted workflow progress should be visible
    And the latest executable action result should be visible

  Scenario: Enforce workspace and revoked-license boundaries
    Given the Module App production gate environment is configured
    When I open the configured team workspace runtime page
    Then the Module App runtime should render without a launch error
    When I open the configured denied workspace runtime page
    Then the Module App runtime should show a denied state
    When I open the configured revoked-license runtime page
    Then the Module App runtime should show a denied state

  Scenario: Display only verified Alipay payment and refund state
    Given the Module App production gate environment is configured
    When I open the configured pending-payment detail page
    Then the Module App detail should show pending payment
    When I open the configured paid-order detail page
    Then the Module App detail should show paid confirmation
    When I open the configured refunded-order detail page
    Then the Module App detail should show refunded state
