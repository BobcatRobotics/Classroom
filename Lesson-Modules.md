# FRC Learning Modules

## Module 1: Hello 'Name'

**Starting State:** Basic Main.java, regular RUN from vs code (not simulated driver station)

### Steps
- Store name as String variable
- System.out.println Hello Name
- Use scanner to have user input name, print hello to them
- Get the date (automatically), print the date too
- Get their age, print that too

### Bonus
- Add protection against bad inputs
- Add first + last name input separately
- Enter age, etc

---

## Module 2: Number Guessing Game

**Starting State:** Basic Main.java, regular RUN from vs code (not simulated driver station)

### Steps
- Use random to generate number between 1 and 10
- Get user guess from scanner
- Print "higher", "lower", or "correct"

### Bonus
- Bigger range of numbers
- Print "score"
- Implement max guesses for win/loss

---

## Module 3: Perimeter/Area

**Starting State:** Basic Main.java, regular RUN from vs code (not simulated driver station)

### Steps
- Get user input from scanner for length and width (of rectangle)
- Calculate perimeter and area and print them
- Add other shape types (i.e. enter 1 for rectangle, 2 for triangle, 3 for circle) - different argument names for each

### Bonus
- Type protection on inputs
- Cube type with volume
- Other shapes

---

## Module 4: Closest Distance

**Starting State:** Robot.java with array of Translation2ds (spread within field bounds), AdvantageKit, real run from simulated driver station

### Steps
- Hardcode a new translation2d
- Use a for loop to iterate over array, print closest point using pure math (sqrt on x + y difference)
- Change hardcoded point to be randomly generated (within field bounds)
- Logger.recordOutput the array of points in one colour, the random point in another colour, and the closest point in a 3rd colour
- Only after completing all this, change pure math distance calculation to use ".distance()" on translation2d
- Then remove entire loop and just use ".nearest()"

---

## Module 5: Perimeter/Area Part 2 (Class Based)

**Starting State:** Robot.java, AdvantageKit, real run from simulated driver station

### Steps
- Right click, create new class command, empty class, call it Rectangle
- Make a constructor that takes length and width
- Make .perimeter() and .area() public functions
- In Robot.java, create a rectangle, Logger.recordOutput its length, width, perimeter and area (under "Rectangle/")
- Make a class triangle, do the same
- Make a class circle, do the same

### Bonus
- Make an interface Shape that declares perimeter and area functions as well as a name
- Make all the shape classes implement Shape and hardcode names in their constructor
- Make an array of Shape[] in Robot.java and use a for loop to Logger.recordOutput all of their perimeters and areas

---

## Module 6: Score Predictor

**Starting State:** Robot.java, AdvantageKit, real run from simulated driver station, class files for FrcMatch, FrcAlliance, FrcTeam

### Steps
- Follow https://www.programiz.com/online-compiler/4CgVNmQdApYOY
- (may need to clean it up a bit, view logger output in AdvantageScope?)

---

## Module 7: Timed Robot

**Starting State:** Robot.java (with teleopInit and teleopPeriodic), AdvantageKit, real run from simulated driver station

### Steps
- Logger.recordOutput("RobotState") as "TeleopInit" and "TeleopPeriodic" in the respective functions
- "Blink LED" just flipping boolean (or 1/0) periodically, look at what loop time is from line graph in AdvantageScope
- Blink LED more slowly using Timer.getFPGATimestamp to store lastChangeTime, compare lastChangeTime to current time and flip when time elapsed
- Create controller object
- In periodic, check button A state, set to true if true, set to false if false, test with keyboard controls
- Logger.recordOutput a joystick value, use WASD to view

### Bonus
- Make boolean only flip true when all 4 face buttons are pressed
- Log a Pose2d and increment X/Y when joysticks move

---

## Module 8: Command-Based Robot

**Starting State:** Real robot project, RobotContainer with controller pre-created, commands folder with stuff like "DriveForwardCommand" (drive in all 4 directions, turn left, turn right; all take distance args), drive subsystem that just logs and periodically updates a pose, auto chooser with only one option (premade auto command, just Commands.none() to start)

### Steps
- Make the premade autonomous command drive in a square by chaining together "DriveForward", "Turn", run it from driver station and watch logged pose
- Bind commands to joystick with onTrue, make the robot drive around the field
- Make the robot do a "Figure 8" around the field, going under all 4 bumps, bind this to A (and make resetPose back to starting on B) (or cut-the-rope star style map)

### Bonus
- Other driving maneuvers can try to make whileTrue work smoothly by driving forward small increments (like 1cm at a time)

---

## Module 9: Kitbot Template

**Starting State:** Advantagekit kitbot template with slowed max speed

### Steps
- Add a "fast mode" button that when held, makes the drive speed 2x
- Add a "beyblade mode" button that when held, spins the robot in place as fast as possible
- Start with making this a command that requires the drive subsystem
- Then, try to make translation still work while this is active

### Bonus
- Add a button to toggle between "blue alliance" and "red alliance" driving modes (controls get mirrored)

---

## Module 10: PID Controllers

**Starting State:** Advantagekit kitbot template with FieldConstants that defines blue hub

### Steps
- Add a PID to the shooter flywheel
- Add a chassis orientation PID that aims at the hub

### Bonus
- Aim at other areas of the field (passing zones)
