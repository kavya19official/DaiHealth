(function () {
  'use strict';
  // Educational ranges follow ACOG and the NHS week-by-week guide. Weekly
  // prompts are journaling cues. Development occurs over days and weeks.
  const chapters = [
    [1, 2, 'Pregnancy dating starts from the first day of the last period. These early calendar weeks usually come before conception.', 'Your body is following its usual cycle. This can be a useful place to begin your story.'],
    [3, 4, 'If conception occurs, a group of dividing cells travels toward the uterus and may implant in its lining.', 'You may feel much the same as usual. You can write about what this period of waiting felt like.'],
    [5, 8, 'The early brain and spine begin developing. Tiny limb buds and the foundations of facial features are taking shape.', 'Some people feel tired, nauseated or more sensitive to smells. Excitement and uncertainty can come together.'],
    [9, 12, 'The limbs, face and eyelids continue to develop, and the first small movements are taking place.', 'Energy, appetite and mood can change from day to day. Give yourself room to write about how things actually feel.'],
    [13, 16, 'Bones are hardening and limb movements are becoming more coordinated.', 'Your shape or energy may be changing. There is no required way to feel as a new trimester begins.'],
    [17, 20, 'Movement is getting more coordinated. Some people begin to notice small flutters around this part of pregnancy.', 'Your body may feel different as it makes room. This can be a time of anticipation, questions or both.'],
    [21, 24, 'The senses continue developing, and the lungs are still maturing.', 'A growing bump may change how you get comfortable or sleep. Your diary can hold little details about your everyday routines.'],
    [25, 27, 'The baby is growing and putting on more fat. Responses to sound and movement are becoming more noticeable.', 'Rest may be harder to find. It is okay to write about ordinary frustrations alongside moments you want to celebrate.'],
    [28, 32, 'The baby continues to gain weight. The eyes can open and close as they develop.', 'You may feel heavier or need more breaks. Plans for the weeks ahead can bring both excitement and worry.'],
    [33, 36, 'The baby keeps gaining weight, while the brain and lungs continue developing.', 'It may take time to settle into a comfortable position. You might also be thinking about who you want nearby at birth.'],
    [37, 40, 'The baby’s brain and lungs continue to mature in the final weeks. The due date is an estimate.', 'Waiting can feel long, even when you are looking forward to meeting your baby. Write down what you want to remember about this time.'],
  ];
  const prompts = [
    'How would you describe the beginning of this story?', 'What were you hoping for this week?',
    'What ordinary detail would you like to remember?', 'Who did you first want to tell?',
    'How did you feel when the possibility became real?', 'What brought you comfort today?',
    'What surprised you about this week?', 'What helped on the days that felt harder?',
    'What is one small thing you noticed changing?', 'What made you laugh this week?',
    'What were you curious about?', 'What would you tell yourself at the start of this trimester?',
    'How did the beginning of a new trimester feel?', 'Which everyday moment felt special?',
    'Did you take a photo you want to keep?', 'What are you looking forward to next?',
    'What did you learn about yourself this week?', 'What did you notice when you slowed down?',
    'Who made you feel supported?', 'What do you want to remember about reaching the halfway point?',
    'What would you like to say to your baby today?', 'What felt different about your routine?',
    'Was there a sound, song or voice you want to remember?', 'What did a good day look like?',
    'What did you do to make yourself more comfortable?', 'What kind thing did someone do for you?',
    'Which moment from this trimester would you keep?', 'How did it feel to enter the final trimester?',
    'What do you want your baby to know about your family?', 'What memory would you put in a photo album?',
    'What do you notice about the way you spend your days now?', 'What are you making space for?',
    'What went through your mind when you thought about meeting your baby?', 'Who do you want beside you in the coming weeks?',
    'What has helped you get more comfortable lately?', 'What is one thing you feel ready for?',
    'What does waiting feel like today?', 'What do you want to remember about home right now?',
    'Which memory from the whole journey stands out?', 'What are the first words you want to say to your baby?',
  ];
  window.PregnancyLibraryGuide = week => {
    const chapter = chapters.find(([first, last]) => week >= first && week <= last);
    return chapter && { baby:chapter[2], mother:chapter[3], prompt:prompts[week - 1] };
  };
})();
