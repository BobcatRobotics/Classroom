package first.robot;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.wpilib.hardware.hal.HAL;

class RobotContainerTest {
  @BeforeAll
  static void initializeHal() {
    assert HAL.initialize();
  }

  @Test
  void robotContainerCreatesDefaultAutonomousCommand() {
    RobotContainer container = new RobotContainer();

    assertNotNull(container);
    assertNotNull(container.getAutonomousCommand());
  }

  @Test
  void robotPeriodicRunsWithoutThrowing() {
    RobotContainer container = new RobotContainer();

    assertNotNull(container);
    assertDoesNotThrow(container::robotPeriodic);
  }
}
