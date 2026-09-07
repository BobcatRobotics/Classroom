// Copyright (c) FIRST and other WPILib contributors.
// Open Source Software; you can modify and/or share it under the terms of
// the WPILib BSD license file in the root directory of this project.

package first.robot;

import org.littletonrobotics.junction.Logger;
import org.wpilib.math.geometry.Pose2d;
import org.wpilib.math.geometry.Rotation2d;
import org.wpilib.system.Timer;
import org.wpilib.command3.*;

public class RobotContainer {
  private final Timer timer = new Timer();
  private long counter = 0;

  public RobotContainer() {
    timer.start();
    configureBindings();
  }

  private void configureBindings() {}

  public Command getAutonomousCommand() {
    return Command.noRequirements(coroutine -> {
      System.out.println("No autonomous command configured");
    }).named("Comamnd Not Configured");
  }

  /** Called every loop while the robot is running. Add your own logic here. */
  public void robotPeriodic() {
    // A counter that ticks up once per loop.
    counter++;
    Logger.recordOutput("Counter", counter);

    // A pose that drives in a circle around the middle of the field.
    double seconds = timer.get();
    double radius = 2.0;
    double omega = 1.0;
    double x = 4.0 + radius * Math.cos(omega * seconds);
    double y = 4.0 + radius * Math.sin(omega * seconds);
    Rotation2d heading = new Rotation2d(omega * seconds + Math.PI / 2);
    Logger.recordOutput("RobotPose", new Pose2d(x, y, heading));
  }
}
